import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type { PermissionRequestServiceClient } from "@reside/api/access/request.v1"
import type { DiscoveryServiceClient } from "@reside/api/alpha/discovery.v1"
import type {
  AskStreamResponse,
  NaturalLanguageServiceClient,
} from "@reside/api/interaction/nls.v1"
import type { ResideCrypto } from "@reside/common/encryption"
import type { Message } from "grammy/types"
import type { PrismaClient } from "../../database"
import type { TelegramMessageEntity } from "./bot-command-invocation"
import type { SubjectServiceClientLike } from "./notification-types"
import { logger, renderMarkdownAsTelegramHtml, rhid } from "@reside/common"
import { encryptedStringSchema } from "../../definitions"
import { strings } from "../../locale"
import { canAskNls, requestNlsAskPermission } from "./authorization"
import { createTelegramBotClient } from "./bot-client"
import { mapReplicaCallErrorMessage } from "./bot-replica-call"
import { createEcidTextSubstitutor } from "./ecid-substitution"
import { toTelegramSubjectId } from "./subject"
import { replaceSubjectIdsWithTitles } from "./subject-display"

const GROUP_STREAM_EDIT_INTERVAL_MS = 1000
const GROUP_TYPING_INTERVAL_MS = 5000

type SubjectRenderer = (text: string) => Promise<string>

export async function handleNlsMessage(args: {
  prisma: PrismaClient
  subjectService?: SubjectServiceClientLike
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
      message_id?: number
      message_thread_id?: number
    }
  }
  text: string
  sourceText?: string
  entities?: TelegramMessageEntity[]
  mentionedUsername: string | undefined
}): Promise<void> {
  const telegramBotClientFactory = args.createTelegramBotClient ?? createTelegramBotClient
  const subjectService = args.subjectService ?? {
    async getSubjectDisplayInfo(input: { subjectId: string }) {
      return { title: input.subjectId }
    },
  }
  const ecidSubstitutor = createEcidTextSubstitutor(args.crypto, {
    onDecryptError: ({ ecid, error }) => {
      logger.warn({ error, ecid }, 'failed to decrypt ecid during nls substitution ecid="%s"', ecid)
    },
  })
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

  const telegramUserRhid = rhid(String(args.userId))
  const repliedMessageRhid =
    typeof args.message.reply_to_message?.message_id === "number"
      ? createTelegramMessageRhid(args.chatId, args.message.reply_to_message.message_id)
      : undefined

  const interaction =
    args.mentionedUsername !== undefined
      ? await resolveMentionedReplicaInteraction(args.prisma, chat.id, telegramUserRhid, {
          mentionedUsername: args.mentionedUsername,
        })
      : repliedMessageRhid !== undefined
        ? await resolveRepliedReplicaInteraction(args.prisma, repliedMessageRhid)
        : null

  if (!interaction) {
    return
  }

  if (interaction.user.telegramRhid !== telegramUserRhid) {
    const botToken = await resolveReplicaAvatarToken(
      args.crypto,
      args.prisma,
      interaction.replicaName,
    )
    const replyBot = telegramBotClientFactory(botToken ?? args.managerToken, {
      role: "worker.nls-reaction",
    })

    await setNlsDislikeReaction({
      bot: replyBot,
      chatId: args.chatId,
      messageId: args.message.message_id,
    })
    return
  }

  const fromSubjectId = toTelegramSubjectId(interaction.user.id)
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
      subjectRenderer: text =>
        replaceSubjectIdsWithTitles(args.crypto, args.prisma, subjectService, text),
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
      subjectRenderer: text =>
        replaceSubjectIdsWithTitles(args.crypto, args.prisma, subjectService, text),
    })
  }

  try {
    const endpoint = await args.discoveryService.getSubjectEndpoint({
      subjectId: toSubjectId,
    })

    const sessionReference = resolveNlsRequestSessionReference({
      interactionSessionId: interaction.sessionId,
      isMention: args.mentionedUsername !== undefined,
      isReplyToTrackedAvatarMessage: repliedMessageRhid !== undefined,
    })
    const shouldSendContinuationNotice = sessionReference?.case === "lastSessionId"
    const previousSessionId = interaction.sessionId
    const previousMessageLink = await decryptOptionalString(
      args.crypto,
      interaction.lastMessageLinkEcid,
    )
    const nlsFrames = args.getNaturalLanguageClient(endpoint.endpoint).askStream({
      text: args.text,
      subjectId: fromSubjectId,
      ...(sessionReference === undefined ? {} : { sessionReference }),
    })

    if (groupChat) {
      const result = await streamNlsReplyGroupFrames({
        bot: replyBot,
        chatId: args.chatId,
        messageThreadId: draftMessageThreadId,
        replyToMessageId: args.message.message_id,
        frames: nlsFrames,
        ecidSubstitutor,
        subjectRenderer: text =>
          replaceSubjectIdsWithTitles(args.crypto, args.prisma, subjectService, text),
        onSessionId: async sessionId => {
          await sendContinuationNoticeIfNeeded({
            bot: telegramBotClientFactory(args.managerToken, { role: "worker.nls-continuation" }),
            chatId: args.chatId,
            replyToMessageId: args.message.message_id,
            replicaTitle: await resolveReplicaTitle(args.prisma, interaction.replicaName),
            shouldSend: shouldSendContinuationNotice,
            previousSessionId,
            previousMessageLink,
            sessionId,
          })
        },
      })

      if (result.text.trim().length === 0) {
        throw new Error("NLS returned empty streamed response")
      }

      await persistNlsInteractionResult(args.crypto, args.prisma, {
        interactionId: interaction.id,
        telegramChatId: args.chatId,
        messageThreadId: draftMessageThreadId,
        avatarMessageId: result.messageId,
        userMessageId: args.message.message_id,
        sessionId: result.sessionId,
      })

      return
    }

    const result = await streamNlsReplyDraftFrames({
      bot: replyBot,
      chatId: args.chatId,
      messageThreadId: draftMessageThreadId,
      draftId,
      frames: nlsFrames,
      ecidSubstitutor,
      subjectRenderer: text =>
        replaceSubjectIdsWithTitles(args.crypto, args.prisma, subjectService, text),
    })

    if (result.text.trim().length === 0) {
      throw new Error("NLS returned empty streamed response")
    }

    await sendContinuationNoticeIfNeeded({
      bot: telegramBotClientFactory(args.managerToken, { role: "worker.nls-continuation" }),
      chatId: args.chatId,
      replyToMessageId: args.message.message_id,
      replicaTitle: await resolveReplicaTitle(args.prisma, interaction.replicaName),
      shouldSend: shouldSendContinuationNotice,
      previousSessionId,
      previousMessageLink,
      sessionId: result.sessionId,
    })

    const sentMessage = await sendNlsReplyMessage({
      bot: replyBot,
      chatId: args.chatId,
      replyToMessageId: args.message.message_id,
      text: result.text,
      ecidSubstitutor,
      subjectRenderer: text =>
        replaceSubjectIdsWithTitles(args.crypto, args.prisma, subjectService, text),
    })

    await persistNlsInteractionResult(args.crypto, args.prisma, {
      interactionId: interaction.id,
      telegramChatId: args.chatId,
      messageThreadId: draftMessageThreadId,
      avatarMessageId: sentMessage.message_id,
      userMessageId: args.message.message_id,
      sessionId: result.sessionId,
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
      subjectRenderer: text =>
        replaceSubjectIdsWithTitles(args.crypto, args.prisma, subjectService, text),
    })
  }
}

async function resolveMentionedReplicaInteraction(
  prisma: PrismaClient,
  chatId: number,
  telegramUserRhid: string,
  input: {
    mentionedUsername: string
  },
): Promise<{
  id: number
  replicaName: string
  sessionId: string | null
  lastMessageLinkEcid: string | null
  user: {
    id: number
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

  const interaction = await prisma.naturalLanguageInteraction.upsert({
    where: {
      chatId_userId_replicaName: {
        chatId,
        userId: owner.id,
        replicaName: avatar.replicaName,
      },
    },
    create: {
      chatId,
      userId: owner.id,
      replicaName: avatar.replicaName,
    },
    update: {
      userId: owner.id,
      replicaName: avatar.replicaName,
    },
    select: {
      id: true,
      sessionId: true,
      lastMessageLinkEcid: true,
    },
  })

  return {
    id: interaction.id,
    replicaName: avatar.replicaName,
    sessionId: interaction.sessionId,
    lastMessageLinkEcid: interaction.lastMessageLinkEcid,
    user: {
      id: owner.id,
      telegramRhid: owner.telegramRhid,
    },
  }
}

async function resolveRepliedReplicaInteraction(
  prisma: PrismaClient,
  messageRhid: string,
): Promise<{
  id: number
  replicaName: string
  sessionId: string | null
  lastMessageLinkEcid: string | null
  user: {
    id: number
    telegramRhid: string
  }
} | null> {
  const message = await prisma.naturalLanguageInteractionMessage.findUnique({
    where: {
      messageRhid,
    },
    select: {
      sender: true,
      interaction: {
        select: {
          id: true,
          replicaName: true,
          sessionId: true,
          lastMessageLinkEcid: true,
          user: {
            select: {
              id: true,
              telegramRhid: true,
            },
          },
        },
      },
    },
  })

  if (!message || message.sender !== "AVATAR") {
    return null
  }

  return message.interaction
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
  subjectRenderer: SubjectRenderer
}): Promise<void> {
  const text = await renderNlsReplyText(args.text, args.ecidSubstitutor, args.subjectRenderer)

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
  subjectRenderer: SubjectRenderer
}): Promise<{ text: string; sessionId: string }> {
  let finalText = ""
  let sessionId = ""
  let hasFrame = false

  for await (const frame of args.frames) {
    const frameSessionId = getFrameSessionId(frame)
    if (frameSessionId.length > 0) {
      sessionId = frameSessionId
    }

    if (frame.text.trim().length === 0) {
      continue
    }

    if (frame.reset && hasFrame) {
      await sendNlsReplyDraftMessage({
        bot: args.bot,
        chatId: args.chatId,
        messageThreadId: args.messageThreadId,
        draftId: args.draftId,
        text: "",
        ecidSubstitutor: args.ecidSubstitutor,
        subjectRenderer: args.subjectRenderer,
      })
    }

    await sendNlsReplyDraftMessage({
      bot: args.bot,
      chatId: args.chatId,
      messageThreadId: args.messageThreadId,
      draftId: args.draftId,
      text: frame.text,
      ecidSubstitutor: args.ecidSubstitutor,
      subjectRenderer: args.subjectRenderer,
    })

    hasFrame = true
    finalText = frame.text
  }

  return { text: finalText, sessionId }
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
  subjectRenderer: SubjectRenderer
  onSessionId?: (sessionId: string) => Promise<void>
}): Promise<{ text: string; sessionId: string; messageId: number }> {
  const stopTypingLoop = startTypingStatusLoop({
    bot: args.bot,
    chatId: args.chatId,
    messageThreadId: args.messageThreadId,
  })

  try {
    const iterator = args.frames[Symbol.asyncIterator]()

    let sessionId = ""
    let sessionNotified = false
    const notifySession = async () => {
      if (sessionNotified || sessionId.length === 0) {
        return
      }

      sessionNotified = true
      await args.onSessionId?.(sessionId)
    }
    let firstFrame = await iterator.next()
    while (!firstFrame.done && getFrameSessionId(firstFrame.value).length > 0) {
      sessionId = getFrameSessionId(firstFrame.value)
      await notifySession()
      if (firstFrame.value.text.trim().length > 0) {
        break
      }

      firstFrame = await iterator.next()
    }

    while (!firstFrame.done && firstFrame.value.text.trim().length === 0) {
      const frameSessionId = getFrameSessionId(firstFrame.value)
      if (frameSessionId.length > 0) {
        sessionId = frameSessionId
        await notifySession()
      }

      firstFrame = await iterator.next()
    }

    if (firstFrame.done) {
      return { text: "", sessionId, messageId: 0 }
    }

    const firstFrameSessionId = getFrameSessionId(firstFrame.value)
    if (firstFrameSessionId.length > 0) {
      sessionId = firstFrameSessionId
      await notifySession()
    }

    const firstText = await renderNlsReplyText(
      firstFrame.value.text,
      args.ecidSubstitutor,
      args.subjectRenderer,
    )

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

        const frameSessionId = getFrameSessionId(frame.value)
        if (frameSessionId.length > 0) {
          sessionId = frameSessionId
        }

        if (frame.value.text.trim().length === 0) {
          continue
        }

        latestPendingText = await renderNlsReplyText(
          frame.value.text,
          args.ecidSubstitutor,
          args.subjectRenderer,
        )
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

    return { text: finalText, sessionId, messageId: streamedMessageId }
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

function getFrameSessionId(frame: AskStreamResponse): string {
  return frame.sessionId?.trim() ?? ""
}

async function sendNlsReplyMessage(args: {
  bot: ReturnType<typeof createTelegramBotClient>
  chatId: number
  replyToMessageId: number
  text: string
  ecidSubstitutor: {
    substituteInText: (text: string) => Promise<string>
  }
  subjectRenderer: SubjectRenderer
}): Promise<Message.TextMessage> {
  const text = await renderNlsReplyText(args.text, args.ecidSubstitutor, args.subjectRenderer)

  return await args.bot.api.sendMessage(args.chatId, text, {
    parse_mode: "HTML",
    link_preview_options: {
      is_disabled: true,
    },
    reply_parameters: {
      message_id: args.replyToMessageId,
    },
  })
}

type NlsRequestSessionReference =
  | { case: "sessionId"; value: string }
  | { case: "lastSessionId"; value: string }
  | undefined

function resolveNlsRequestSessionReference(args: {
  interactionSessionId: string | null
  isMention: boolean
  isReplyToTrackedAvatarMessage: boolean
}): NlsRequestSessionReference {
  if (!args.interactionSessionId) {
    return undefined
  }

  if (args.isReplyToTrackedAvatarMessage) {
    return { case: "sessionId", value: args.interactionSessionId }
  }

  if (args.isMention) {
    return { case: "lastSessionId", value: args.interactionSessionId }
  }

  return { case: "sessionId", value: args.interactionSessionId }
}

async function decryptOptionalString(
  crypto: ResideCrypto,
  ecid: string | null,
): Promise<string | null> {
  if (!ecid) {
    return null
  }

  return await crypto.decrypt(encryptedStringSchema, ecid)
}

async function sendContinuationNoticeIfNeeded(args: {
  bot: ReturnType<typeof createTelegramBotClient>
  chatId: number
  replyToMessageId: number
  replicaTitle: string
  shouldSend: boolean
  previousSessionId: string | null
  previousMessageLink: string | null
  sessionId: string
}): Promise<void> {
  if (
    !args.shouldSend ||
    !args.previousSessionId ||
    args.previousSessionId !== args.sessionId ||
    !args.previousMessageLink
  ) {
    return
  }

  await args.bot.api.sendMessage(
    args.chatId,
    `${escapeTelegramHtml(args.replicaTitle)} решила продолжить предыдущий <a href="https://${escapeTelegramHtml(args.previousMessageLink)}">диалог</a>`,
    {
      parse_mode: "HTML",
      link_preview_options: {
        is_disabled: true,
      },
      reply_parameters: {
        message_id: args.replyToMessageId,
      },
    },
  )
}

async function resolveReplicaTitle(prisma: PrismaClient, replicaName: string): Promise<string> {
  const avatar = await prisma.avatar.findUnique({
    where: {
      replicaName,
    },
    select: {
      replicaTitle: true,
    },
  })

  return avatar?.replicaTitle ?? replicaName
}

async function persistNlsInteractionResult(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  input: {
    interactionId: number
    telegramChatId: number
    messageThreadId: number | undefined
    avatarMessageId: number
    userMessageId: number
    sessionId: string
  },
): Promise<void> {
  if (input.sessionId.trim().length === 0 || input.avatarMessageId === 0) {
    return
  }

  const messageLinkEcid = await crypto.encrypt(
    createTelegramMessageLink(input.telegramChatId, input.avatarMessageId, input.messageThreadId),
  )

  await prisma.naturalLanguageInteraction.update({
    where: {
      id: input.interactionId,
    },
    data: {
      sessionId: input.sessionId,
      lastMessageLinkEcid: messageLinkEcid,
      messages: {
        upsert: [
          {
            where: {
              messageRhid: createTelegramMessageRhid(input.telegramChatId, input.userMessageId),
            },
            create: {
              messageRhid: createTelegramMessageRhid(input.telegramChatId, input.userMessageId),
              sender: "USER",
            },
            update: {
              sender: "USER",
            },
          },
          {
            where: {
              messageRhid: createTelegramMessageRhid(input.telegramChatId, input.avatarMessageId),
            },
            create: {
              messageRhid: createTelegramMessageRhid(input.telegramChatId, input.avatarMessageId),
              sender: "AVATAR",
            },
            update: {
              sender: "AVATAR",
            },
          },
        ],
      },
    },
  })
}

async function setNlsDislikeReaction(args: {
  bot: ReturnType<typeof createTelegramBotClient>
  chatId: number
  messageId: number
}): Promise<void> {
  await args.bot.api.setMessageReaction(args.chatId, args.messageId, [
    {
      type: "emoji",
      emoji: "👎",
    },
  ])
}

function createTelegramMessageRhid(chatId: number, messageId: number): string {
  return rhid({ chatId: String(chatId), messageId: String(messageId) })
}

function createTelegramMessageLink(
  chatId: number,
  messageId: number,
  messageThreadId: number | undefined,
): string {
  const linkChatId = String(chatId).replace(/^-100/, "")

  if (messageThreadId !== undefined) {
    return `t.me/c/${linkChatId}/${messageThreadId}/${messageId}`
  }

  return `t.me/c/${linkChatId}/${messageId}`
}

function escapeTelegramHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

async function renderNlsReplyText(
  text: string,
  ecidSubstitutor: {
    substituteInText: (text: string) => Promise<string>
  },
  subjectRenderer: SubjectRenderer,
): Promise<string> {
  const substitutedText = await ecidSubstitutor.substituteInText(text)
  const renderedText = await subjectRenderer(substitutedText)
  return renderMarkdownAsTelegramHtml(renderedText).html
}
