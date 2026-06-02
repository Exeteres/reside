import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type { PermissionRequestServiceClient } from "@reside/api/access/request.v1"
import type { DiscoveryServiceClient } from "@reside/api/alpha/discovery.v1"
import type {
  AskStreamResponse,
  NaturalLanguageServiceClient,
} from "@reside/api/interaction/nls.v1"
import type { PrismaClient } from "../../database"
import { strings } from "../../locale"
import { canAskNls, requestNlsAskPermission } from "./authorization"
import { createTelegramBotClient } from "./bot-client"
import { resolveNlsMessageThreadId } from "./bot-command"
import { mapReplicaCallErrorMessage } from "./bot-replica-call"

const GROUP_STREAM_EDIT_INTERVAL_MS = 1000
const GROUP_TYPING_INTERVAL_MS = 5000

export async function handleNlsMessage(args: {
  prisma: PrismaClient
  discoveryService: DiscoveryServiceClient
  authzService: AuthzServiceClient
  permissionRequestService: PermissionRequestServiceClient
  getNaturalLanguageClient: (endpoint: string) => NaturalLanguageServiceClient
  createTelegramBotClient?: typeof createTelegramBotClient
  managerToken: string
  chatId: number
  userId: number
  message: {
    message_id: number
    is_topic_message?: boolean
    message_thread_id?: number
    reply_to_message?: {
      message_thread_id?: number
    }
  }
  text: string
  mentionedUsername: string | undefined
}): Promise<void> {
  const telegramBotClientFactory = args.createTelegramBotClient ?? createTelegramBotClient
  const messageThreadId = resolveNlsMessageThreadId(args.message)
  const draftMessageThreadId = resolveNlsDraftMessageThreadId(args.message)
  const chatId = String(args.chatId)
  const telegramUserId = String(args.userId)

  const interaction =
    args.mentionedUsername !== undefined
      ? await resolveMentionedReplicaInteraction(args.prisma, chatId, telegramUserId, {
          threadId: messageThreadId,
          mentionedUsername: args.mentionedUsername,
        })
      : await args.prisma.naturalLanguageInteraction.findUnique({
          where: {
            chatId_threadId: {
              chatId,
              threadId: messageThreadId,
            },
          },
          select: {
            replicaName: true,
            user: {
              select: {
                telegramId: true,
              },
            },
          },
        })

  if (!interaction) {
    return
  }

  if (interaction.user.telegramId !== telegramUserId) {
    const replyBot = telegramBotClientFactory(args.managerToken, {
      role: "worker.nls-reply",
    })

    await sendNlsReplyMessage({
      bot: replyBot,
      chatId: args.chatId,
      replyToMessageId: args.message.message_id,
      text: strings.worker.bot.nlsSessionOwnedByAnotherUser(interaction.replicaName),
    })
    return
  }

  const fromSubjectId = `telegram:${args.userId}`
  const toSubjectId = `replica:${interaction.replicaName}`

  const permission = await canAskNls({
    authzService: args.authzService,
    fromSubjectId,
    toSubjectId,
  })

  if (!permission.authorized) {
    if (permission.checked) {
      await requestNlsAskPermission({
        permissionRequestService: args.permissionRequestService,
        fromSubjectId,
        toSubjectId,
      })
    }

    const botToken = await resolveReplicaAvatarToken(args.prisma, interaction.replicaName)
    const replyBot = telegramBotClientFactory(botToken ?? args.managerToken, {
      role: "worker.nls-reply",
    })

    await sendNlsReplyMessage({
      bot: replyBot,
      chatId: args.chatId,
      replyToMessageId: args.message.message_id,
      text: strings.common.accessDenied,
    })
    return
  }

  const avatarToken = await resolveReplicaAvatarToken(args.prisma, interaction.replicaName)
  const replyBot = telegramBotClientFactory(avatarToken ?? args.managerToken, {
    role: "worker.nls-reply",
  })
  const groupChat = isGroupChat(args.chatId)
  const draftId = resolveNlsReplyDraftId(args.message.message_id)

  if (!groupChat) {
    await sendNlsReplyDraftMessage({
      bot: replyBot,
      chatId: args.chatId,
      messageThreadId: draftMessageThreadId,
      draftId,
      text: "",
    })
  }

  try {
    const endpoint = await args.discoveryService.getSubjectEndpoint({
      subjectId: toSubjectId,
    })

    const nlsFrames = args.getNaturalLanguageClient(endpoint.endpoint).askStream({
      text: args.text,
      subjectId: fromSubjectId,
    })

    if (groupChat) {
      const finalText = await streamNlsReplyGroupFrames({
        bot: replyBot,
        chatId: args.chatId,
        messageThreadId: draftMessageThreadId,
        replyToMessageId: args.message.message_id,
        frames: nlsFrames,
      })

      if (finalText.trim().length === 0) {
        throw new Error("NLS returned empty streamed response")
      }

      return
    }

    const finalText = await streamNlsReplyDraftFrames({
      bot: replyBot,
      chatId: args.chatId,
      messageThreadId: draftMessageThreadId,
      draftId,
      frames: nlsFrames,
    })

    if (finalText.trim().length === 0) {
      throw new Error("NLS returned empty streamed response")
    }

    await sendNlsReplyMessage({
      bot: replyBot,
      chatId: args.chatId,
      replyToMessageId: args.message.message_id,
      text: finalText,
    })
  } catch (error) {
    const mappedMessage = mapReplicaCallErrorMessage(error, {
      deadMessage: strings.worker.bot.nlsReplicaUnavailable,
      brokenMessage: strings.worker.bot.nlsReplicaBroken,
    })

    await sendNlsReplyMessage({
      bot: replyBot,
      chatId: args.chatId,
      replyToMessageId: args.message.message_id,
      text: mappedMessage,
    })
  }
}

async function resolveMentionedReplicaInteraction(
  prisma: PrismaClient,
  chatId: string,
  telegramUserId: string,
  input: {
    threadId: number
    mentionedUsername: string
  },
): Promise<{
  replicaName: string
  user: {
    telegramId: string
  }
} | null> {
  const avatar = await prisma.avatar.findFirst({
    where: {
      managedBotUsername: {
        equals: input.mentionedUsername,
        mode: "insensitive",
      },
    },
    select: {
      replicaName: true,
    },
  })

  if (!avatar) {
    return null
  }

  const owner = await prisma.user.findUnique({
    where: {
      telegramId: telegramUserId,
    },
    select: {
      id: true,
      telegramId: true,
    },
  })

  if (!owner) {
    return null
  }

  await prisma.naturalLanguageInteraction.upsert({
    where: {
      chatId_threadId: {
        chatId,
        threadId: input.threadId,
      },
    },
    create: {
      chatId,
      userId: owner.id,
      threadId: input.threadId,
      replicaName: avatar.replicaName,
    },
    update: {
      userId: owner.id,
      replicaName: avatar.replicaName,
    },
    select: {
      id: true,
    },
  })

  return {
    replicaName: avatar.replicaName,
    user: {
      telegramId: owner.telegramId,
    },
  }
}

async function resolveReplicaAvatarToken(
  prisma: PrismaClient,
  replicaName: string,
): Promise<string | null> {
  const avatar = await prisma.avatar.findUnique({
    where: {
      replicaName,
    },
    select: {
      token: true,
    },
  })

  return avatar?.token ?? null
}

function resolveNlsReplyDraftId(messageId: number): number {
  return messageId === 0 ? 1 : messageId
}

function resolveNlsDraftMessageThreadId(message: {
  is_topic_message?: boolean
  message_thread_id?: number
}): number | undefined {
  if (message.is_topic_message !== true) {
    return undefined
  }

  const directThreadId = message.message_thread_id
  if (typeof directThreadId === "number" && Number.isInteger(directThreadId)) {
    return directThreadId
  }

  return undefined
}

async function sendNlsReplyDraftMessage(args: {
  bot: ReturnType<typeof createTelegramBotClient>
  chatId: number
  messageThreadId?: number
  draftId: number
  text: string
}): Promise<void> {
  await args.bot.api.sendMessageDraft(args.chatId, args.draftId, args.text, {
    message_thread_id: args.messageThreadId,
    parse_mode: "HTML",
  })
}

async function streamNlsReplyDraftFrames(args: {
  bot: ReturnType<typeof createTelegramBotClient>
  chatId: number
  messageThreadId?: number
  draftId: number
  frames: AsyncIterable<AskStreamResponse>
}): Promise<string> {
  let finalText = ""
  let hasFrame = false

  for await (const frame of args.frames) {
    if (frame.reset && hasFrame) {
      await sendNlsReplyDraftMessage({
        bot: args.bot,
        chatId: args.chatId,
        messageThreadId: args.messageThreadId,
        draftId: args.draftId,
        text: "",
      })
    }

    await sendNlsReplyDraftMessage({
      bot: args.bot,
      chatId: args.chatId,
      messageThreadId: args.messageThreadId,
      draftId: args.draftId,
      text: frame.text,
    })

    hasFrame = true
    finalText = frame.text
  }

  return finalText
}

async function streamNlsReplyGroupFrames(args: {
  bot: ReturnType<typeof createTelegramBotClient>
  chatId: number
  messageThreadId?: number
  replyToMessageId: number
  frames: AsyncIterable<AskStreamResponse>
}): Promise<string> {
  const stopTypingLoop = startTypingStatusLoop({
    bot: args.bot,
    chatId: args.chatId,
    messageThreadId: args.messageThreadId,
  })

  try {
    const iterator = args.frames[Symbol.asyncIterator]()

    let firstFrame = await iterator.next()
    while (!firstFrame.done && firstFrame.value.text.trim().length === 0) {
      firstFrame = await iterator.next()
    }

    if (firstFrame.done) {
      return ""
    }

    const firstText = firstFrame.value.text

    const sentMessage = await args.bot.api.sendMessage(args.chatId, firstText, {
      parse_mode: "HTML",
      link_preview_options: {
        is_disabled: true,
      },
      reply_parameters: {
        message_id: args.replyToMessageId,
      },
      message_thread_id: args.messageThreadId,
    })

    const streamedMessageId = sentMessage.message_id
    let finalText = firstText
    let displayedText = firstText
    let lastEditAt = 0
    let latestPendingText = ""
    let hasPendingUpdate = false
    let streamCompleted = false
    let streamError: unknown

    const readFrames = (async () => {
      while (true) {
        const frame = await iterator.next()
        if (frame.done) {
          streamCompleted = true
          return
        }

        if (frame.value.text.trim().length === 0) {
          continue
        }

        latestPendingText = frame.value.text
        hasPendingUpdate = true
      }
    })().catch(error => {
      streamError = error
      streamCompleted = true
    })

    while (!streamCompleted || hasPendingUpdate) {
      if (!hasPendingUpdate) {
        await Bun.sleep(50)
        continue
      }

      await throttleStreamEdit(lastEditAt)

      if (!hasPendingUpdate) {
        continue
      }

      const nextText = latestPendingText
      hasPendingUpdate = false

      if (nextText === displayedText) {
        continue
      }

      await args.bot.api.editMessageText(args.chatId, streamedMessageId, nextText, {
        parse_mode: "HTML",
        link_preview_options: {
          is_disabled: true,
        },
      })

      lastEditAt = Date.now()
      displayedText = nextText
      finalText = nextText
    }

    await readFrames

    if (streamError) {
      throw streamError
    }

    return finalText
  } finally {
    stopTypingLoop()
  }
}

async function sendTypingStatus(args: {
  bot: ReturnType<typeof createTelegramBotClient>
  chatId: number
  messageThreadId?: number
}): Promise<void> {
  const options =
    args.messageThreadId === undefined
      ? undefined
      : {
          message_thread_id: args.messageThreadId,
        }

  await args.bot.api.sendChatAction(args.chatId, "typing", options)
}

async function throttleStreamEdit(lastEditAt: number): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastEditAt

  if (lastEditAt > 0 && elapsed < GROUP_STREAM_EDIT_INTERVAL_MS) {
    await Bun.sleep(GROUP_STREAM_EDIT_INTERVAL_MS - elapsed)
  }
}

function startTypingStatusLoop(args: {
  bot: ReturnType<typeof createTelegramBotClient>
  chatId: number
  messageThreadId?: number
}): () => void {
  let stopped = false

  void (async () => {
    while (!stopped) {
      try {
        await sendTypingStatus(args)
      } catch {
        // no-op
      }

      await Bun.sleep(GROUP_TYPING_INTERVAL_MS)
    }
  })()

  return () => {
    stopped = true
  }
}

function isGroupChat(chatId: number): boolean {
  return chatId < 0
}

async function sendNlsReplyMessage(args: {
  bot: ReturnType<typeof createTelegramBotClient>
  chatId: number
  replyToMessageId: number
  text: string
}): Promise<void> {
  await args.bot.api.sendMessage(args.chatId, args.text, {
    parse_mode: "HTML",
    link_preview_options: {
      is_disabled: true,
    },
    reply_parameters: {
      message_id: args.replyToMessageId,
    },
  })
}
