import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type { PermissionRequestServiceClient } from "@reside/api/access/request.v1"
import type { DiscoveryServiceClient } from "@reside/api/alpha/discovery.v1"
import type {
  AskStreamResponse,
  NaturalLanguageServiceClient,
} from "@reside/api/interaction/nls.v1"
import type { ResideCrypto } from "@reside/common/encryption"
import type { PrismaClient } from "../../database"
import { logger, rhid } from "@reside/common"
import { encryptedStringSchema } from "../../definitions"
import { strings } from "../../locale"
import { canAskNls, requestNlsAskPermission } from "./authorization"
import { createTelegramBotClient } from "./bot-client"
import { resolveNlsMessageThreadId } from "./bot-command"
import { mapReplicaCallErrorMessage } from "./bot-replica-call"
import { createEcidTextSubstitutor } from "./ecid-substitution"

const GROUP_STREAM_EDIT_INTERVAL_MS = 1000
const GROUP_TYPING_INTERVAL_MS = 5000

export async function handleNlsMessage(args: {
  prisma: PrismaClient
  discoveryService: DiscoveryServiceClient
  authzService: AuthzServiceClient
  permissionRequestService: PermissionRequestServiceClient
  crypto: ResideCrypto
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
  const ecidSubstitutor = createEcidTextSubstitutor(args.crypto, {
    onDecryptError: ({ ecid, error }) => {
      logger.warn({ error, ecid }, 'failed to decrypt ecid during nls substitution ecid="%s"', ecid)
    },
  })
  const messageThreadId = resolveNlsMessageThreadId(args.message)
  const draftMessageThreadId = resolveNlsDraftMessageThreadId(args.message)
  const chat = await args.prisma.chat.findUnique({
    where: {
      telegramRhid: rhid(String(args.chatId)),
    },
    select: {
      id: true,
    },
  })
  if (chat === null) {
    return
  }

  const threadRhid = rhid(messageThreadId)
  const telegramUserRhid = rhid(String(args.userId))

  const interaction =
    args.mentionedUsername !== undefined
      ? await resolveMentionedReplicaInteraction(args.prisma, chat.id, telegramUserRhid, {
          threadRhid,
          mentionedUsername: args.mentionedUsername,
        })
      : await args.prisma.naturalLanguageInteraction.findUnique({
          where: {
            chatId_threadRhid: {
              chatId: chat.id,
              threadRhid,
            },
          },
          select: {
            replicaName: true,
            user: {
              select: {
                telegramRhid: true,
              },
            },
          },
        })

  if (!interaction) {
    return
  }

  if (interaction.user.telegramRhid !== telegramUserRhid) {
    const replyBot = telegramBotClientFactory(args.managerToken, {
      role: "worker.nls-reply",
    })

    await sendNlsReplyMessage({
      bot: replyBot,
      chatId: args.chatId,
      replyToMessageId: args.message.message_id,
      text: strings.worker.bot.nlsSessionOwnedByAnotherUser(interaction.replicaName),
      ecidSubstitutor,
    })
    return
  }

  const fromSubjectId = `telegram:${args.userId}`
  const toSubjectId = `replica:${interaction.replicaName}`
  const subjectInfo = await resolveTelegramSubjectInfo(args.prisma, telegramUserRhid)

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

    const botToken = await resolveReplicaAvatarToken(
      args.crypto,
      args.prisma,
      interaction.replicaName,
    )
    const replyBot = telegramBotClientFactory(botToken ?? args.managerToken, {
      role: "worker.nls-reply",
    })

    await sendNlsReplyMessage({
      bot: replyBot,
      chatId: args.chatId,
      replyToMessageId: args.message.message_id,
      text: strings.common.accessDenied,
      ecidSubstitutor,
    })
    return
  }

  const avatarToken = await resolveReplicaAvatarToken(
    args.crypto,
    args.prisma,
    interaction.replicaName,
  )
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
      ecidSubstitutor,
    })
  }

  try {
    const endpoint = await args.discoveryService.getSubjectEndpoint({
      subjectId: toSubjectId,
    })

    const nlsFrames = args.getNaturalLanguageClient(endpoint.endpoint).askStream({
      text: args.text,
      subjectId: fromSubjectId,
      subjectInfo,
    })

    if (groupChat) {
      const finalText = await streamNlsReplyGroupFrames({
        bot: replyBot,
        chatId: args.chatId,
        messageThreadId: draftMessageThreadId,
        replyToMessageId: args.message.message_id,
        frames: nlsFrames,
        ecidSubstitutor,
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
      ecidSubstitutor,
    })

    if (finalText.trim().length === 0) {
      throw new Error("NLS returned empty streamed response")
    }

    await sendNlsReplyMessage({
      bot: replyBot,
      chatId: args.chatId,
      replyToMessageId: args.message.message_id,
      text: finalText,
      ecidSubstitutor,
    })
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error : new Error(String(error)),
      },
      "failed to handle nls message",
    )

    const mappedMessage = mapReplicaCallErrorMessage(error, {
      deadMessage: strings.worker.bot.nlsReplicaUnavailable,
      brokenMessage: strings.worker.bot.nlsReplicaBroken,
    })

    await sendNlsReplyMessage({
      bot: replyBot,
      chatId: args.chatId,
      replyToMessageId: args.message.message_id,
      text: mappedMessage,
      ecidSubstitutor,
    })
  }
}

async function resolveTelegramSubjectInfo(
  prisma: PrismaClient,
  telegramRhid: string,
): Promise<Record<string, string>> {
  const user = await prisma.user.findUnique({
    where: {
      telegramRhid,
    },
    select: {
      telegramUserIdEcid: true,
      usernameEcid: true,
      firstNameEcid: true,
      lastNameEcid: true,
    },
  })

  if (!user) {
    return {}
  }

  if (typeof user.telegramUserIdEcid !== "string" || user.telegramUserIdEcid.length === 0) {
    return {}
  }

  const subjectInfo: Record<string, string> = {
    telegram_user_id: user.telegramUserIdEcid,
  }

  if (typeof user.usernameEcid === "string" && user.usernameEcid.length > 0) {
    subjectInfo.username = user.usernameEcid
  }

  if (typeof user.firstNameEcid === "string" && user.firstNameEcid.length > 0) {
    subjectInfo.first_name = user.firstNameEcid
  }

  if (typeof user.lastNameEcid === "string" && user.lastNameEcid.length > 0) {
    subjectInfo.second_name = user.lastNameEcid
  }

  return subjectInfo
}

async function resolveMentionedReplicaInteraction(
  prisma: PrismaClient,
  chatId: number,
  telegramUserRhid: string,
  input: {
    threadRhid: string
    mentionedUsername: string
  },
): Promise<{
  replicaName: string
  user: {
    telegramRhid: string
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
      telegramRhid: telegramUserRhid,
    },
    select: {
      id: true,
      telegramRhid: true,
    },
  })

  if (!owner) {
    return null
  }

  await prisma.naturalLanguageInteraction.upsert({
    where: {
      chatId_threadRhid: {
        chatId,
        threadRhid: input.threadRhid,
      },
    },
    create: {
      chatId,
      userId: owner.id,
      threadRhid: input.threadRhid,
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
      telegramRhid: owner.telegramRhid,
    },
  }
}

async function resolveReplicaAvatarToken(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  replicaName: string,
): Promise<string | null> {
  const avatar = await prisma.avatar.findUnique({
    where: {
      replicaName,
    },
    select: {
      tokenEcid: true,
    },
  })

  return avatar === null ? null : await crypto.decrypt(encryptedStringSchema, avatar.tokenEcid)
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
  ecidSubstitutor: {
    substituteInText: (text: string) => Promise<string>
  }
}): Promise<void> {
  const text = await args.ecidSubstitutor.substituteInText(args.text)

  await args.bot.api.sendMessageDraft(args.chatId, args.draftId, text, {
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
  ecidSubstitutor: {
    substituteInText: (text: string) => Promise<string>
  }
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
        ecidSubstitutor: args.ecidSubstitutor,
      })
    }

    await sendNlsReplyDraftMessage({
      bot: args.bot,
      chatId: args.chatId,
      messageThreadId: args.messageThreadId,
      draftId: args.draftId,
      text: frame.text,
      ecidSubstitutor: args.ecidSubstitutor,
    })

    hasFrame = true
    finalText = await args.ecidSubstitutor.substituteInText(frame.text)
  }

  return finalText
}

async function streamNlsReplyGroupFrames(args: {
  bot: ReturnType<typeof createTelegramBotClient>
  chatId: number
  messageThreadId?: number
  replyToMessageId: number
  frames: AsyncIterable<AskStreamResponse>
  ecidSubstitutor: {
    substituteInText: (text: string) => Promise<string>
  }
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

    const firstText = await args.ecidSubstitutor.substituteInText(firstFrame.value.text)

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

        latestPendingText = await args.ecidSubstitutor.substituteInText(frame.value.text)
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
  ecidSubstitutor: {
    substituteInText: (text: string) => Promise<string>
  }
}): Promise<void> {
  const text = await args.ecidSubstitutor.substituteInText(args.text)

  await args.bot.api.sendMessage(args.chatId, text, {
    parse_mode: "HTML",
    link_preview_options: {
      is_disabled: true,
    },
    reply_parameters: {
      message_id: args.replyToMessageId,
    },
  })
}
