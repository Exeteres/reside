import type { ResideCrypto } from "@reside/common/encryption"
import type { PrismaClient } from "../../database"
import type {
  ActionRow,
  AuthzServiceClientLike,
  SendNotificationInput,
  SubjectServiceClientLike,
  TelegramBotLike,
  UpdateNotificationInput,
} from "./notification-types"
import { Code, ConnectError } from "@connectrpc/connect"
import { rhid } from "@reside/common"
import {
  encryptedStringSchema,
  getTelegramMessageChatId,
  telegramSentMessageSchema,
  telegramTopicThreadSchema,
} from "../../definitions"
import { strings } from "../../locale"
import { createEcidTextSubstitutor } from "./ecid-substitution"
import {
  ensureTargetChatExists,
  parseInteractionContextToken,
  resolveSenderDisplayTitle,
  resolveSenderSubjectId,
} from "./notification-access"
import {
  type NotificationChannelRoute,
  resolveNotificationChannelRoute,
} from "./notification-channel-binding"
import {
  sendAvatarPrivacyModeWarning,
  sendNotificationWithReplyFallback,
} from "./notification-delivery"
import {
  assertChannelName,
  collectCallbackActions,
  toInlineKeyboardMarkupFromActionRows,
  toNotificationActionRows,
  toTelegramMessageText,
  toTelegramMessageTextValue,
} from "./notification-message"
import { getNotificationCallbackActionNames } from "./notification-pagination"
import { parseNotificationTopicId } from "./notification-topic"

const RESPONSE_OPERATION_TITLE = strings.server.notification.responseOperationTitle
const TELEGRAM_REPLICA_SUBJECT_ID = "replica:telegram"

export async function sendNotificationForReplica(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  authzService: AuthzServiceClientLike,
  subjectService: SubjectServiceClientLike,
  createTelegramBotClient: (token: string, args: { role: string }) => TelegramBotLike,
  loadDeliveryConfig: () => Promise<{ botToken: string; systemChatId: string }>,
  replicaName: string,
  input: SendNotificationInput,
): Promise<{ notificationId: string; operationId: number | undefined; messageLink?: string }> {
  const ecidSubstitutor = createEcidTextSubstitutor(crypto)

  if (input.topicId === undefined) {
    assertChannelName(input.channel ?? "")
  }

  assertActionRows(input.actionRows)

  const replicaSubjectId = `replica:${replicaName}`
  const senderSubjectId = await resolveSenderSubjectId(
    authzService,
    replicaSubjectId,
    input.sendAsSubjectId,
  )
  const senderDisplayTitle = await resolveSenderDisplayTitle(
    subjectService,
    senderSubjectId,
    senderSubjectId,
  )

  const deliveryConfig = await loadDeliveryConfig()
  const { channel, target } = await resolveNotificationTarget(crypto, prisma, {
    channelName: input.channel,
    topicId: input.topicId,
    systemChatId: deliveryConfig.systemChatId,
  })

  const callbackActions = collectCallbackActions(input.actionRows)
  const actionRows = toNotificationActionRows(input.actionRows)
  const hasPendingResponse =
    callbackActions.length > 0 || input.requiresTextResponse === true || input.acquireTopic === true

  const avatar = await prisma.avatar.findUnique({
    where: {
      subjectId: senderSubjectId,
    },
    select: {
      tokenEcid: true,
    },
  })

  const isTelegramReplicaSender = senderSubjectId === TELEGRAM_REPLICA_SUBJECT_ID

  const renderedTitle = await ecidSubstitutor.substituteInText(input.title)
  const renderedContent = await ecidSubstitutor.substituteInText(input.content ?? "")
  const renderedActionRows = await renderActionRowsForTelegram(ecidSubstitutor, input.actionRows)

  const messageText = toTelegramMessageText(
    {
      title: renderedTitle,
      content: renderedContent,
    },
    senderDisplayTitle,
    avatar === null && !isTelegramReplicaSender,
  )

  const avatarToken =
    avatar === null ? undefined : await crypto.decrypt(encryptedStringSchema, avatar.tokenEcid)
  const effectiveAvatarToken =
    avatarToken ?? (isTelegramReplicaSender ? deliveryConfig.botToken : undefined)
  const botToken = effectiveAvatarToken ?? deliveryConfig.botToken
  const bot = createTelegramBotClient(botToken, {
    role: "notification.send",
  })
  const replyMarkup = toInlineKeyboardMarkupFromActionRows(renderedActionRows)
  const interactionContext = await parseInteractionContextToken(
    crypto,
    input.contextToken,
    deliveryConfig.systemChatId,
  )
  const targetChatId = target.chatId
  const replyToMessageId =
    target.messageThreadId === undefined && interactionContext.chatId === targetChatId
      ? interactionContext.messageId
      : undefined
  const isAvatarSender = effectiveAvatarToken !== undefined

  const targetChat = await ensureTargetChatExists(crypto, prisma, targetChatId)

  const sendResult = isAvatarSender
    ? await sendNotificationWithReplyFallback(
        bot,
        targetChatId,
        senderSubjectId,
        {
          images: input.images,
          attachments: input.attachments,
        },
        messageText,
        replyMarkup,
        replyToMessageId,
        target.messageThreadId,
      )
    : {
        ...(await sendNotificationWithReplyFallback(
          bot,
          targetChatId,
          senderSubjectId,
          {
            images: input.images,
            attachments: input.attachments,
          },
          messageText,
          replyMarkup,
          replyToMessageId,
          target.messageThreadId,
        )),
        usedReplyFallback: false,
      }

  const sentMessageId = sendResult.sentMessageId
  const sentMessageEcid = await crypto.encrypt(sendResult.sentMessage)
  const messageLinkEcid = await crypto.encrypt(
    createTelegramMessageLink(targetChatId, sentMessageId, target.messageThreadId),
  )
  const usedReplyFallback = sendResult.usedReplyFallback

  if (usedReplyFallback && senderSubjectId !== TELEGRAM_REPLICA_SUBJECT_ID) {
    await sendAvatarPrivacyModeWarning(
      crypto,
      prisma,
      createTelegramBotClient,
      deliveryConfig.botToken,
      targetChatId,
      replicaSubjectId,
      senderSubjectId,
    )
  }

  if (!hasPendingResponse) {
    const notification = await prisma.notification.create({
      data: {
        operationId: null,
        chatId: targetChat.id,
        channelId: channel.id,
        topicId: target.topicId ?? null,
        messageRhid: rhid(sentMessageId),
        messageEcid: sentMessageEcid,
        callingSubjectId: replicaSubjectId,
        sendAsSubjectId: senderSubjectId,
        title: input.title,
        content: input.content ?? "",
        actionRows,
        requiresTextResponse: input.requiresTextResponse === true,
        isProtected: input.protected === true,
        acquireTopic: input.acquireTopic === true,
      },
      select: {
        id: true,
      },
    })

    return {
      notificationId: String(notification.id),
      operationId: undefined,
      messageLink: messageLinkEcid,
    }
  }

  const operationResult = await prisma.$transaction(async tx => {
    const operation = await tx.operation.create({
      data: {
        title: RESPONSE_OPERATION_TITLE,
        description: null,
      },
      select: {
        id: true,
      },
    })

    const notification = await tx.notification.create({
      data: {
        operationId: operation.id,
        chatId: targetChat.id,
        channelId: channel.id,
        topicId: target.topicId ?? null,
        messageRhid: rhid(sentMessageId),
        messageEcid: sentMessageEcid,
        callingSubjectId: replicaSubjectId,
        sendAsSubjectId: senderSubjectId,
        title: input.title,
        content: input.content ?? "",
        actionRows,
        requiresTextResponse: input.requiresTextResponse === true,
        isProtected: input.protected === true,
        acquireTopic: input.acquireTopic === true,
      },
      select: {
        id: true,
      },
    })

    return {
      operationId: operation.id,
      notificationId: notification.id,
    }
  })

  return {
    notificationId: String(operationResult.notificationId),
    operationId: operationResult.operationId,
    messageLink: messageLinkEcid,
  }
}

export async function updateNotificationForReplica(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  subjectService: SubjectServiceClientLike,
  createTelegramBotClient: (token: string, args: { role: string }) => TelegramBotLike,
  loadDeliveryConfig: () => Promise<{ botToken: string; systemChatId: string }>,
  replicaName: string,
  input: UpdateNotificationInput,
): Promise<{ operationId: number | undefined }> {
  const ecidSubstitutor = createEcidTextSubstitutor(crypto)

  const notificationId = parseNotificationId(input.notificationId)
  assertActionRows(input.actionRows)

  const senderSubjectId = `replica:${replicaName}`
  const senderDisplayTitle = await resolveSenderDisplayTitle(
    subjectService,
    senderSubjectId,
    replicaName,
  )

  const avatar = await prisma.avatar.findUnique({
    where: {
      subjectId: senderSubjectId,
    },
    select: {
      tokenEcid: true,
    },
  })

  const isTelegramReplicaSender = senderSubjectId === TELEGRAM_REPLICA_SUBJECT_ID

  if (input.title.length === 0) {
    throw new ConnectError("Notification title must not be empty", Code.InvalidArgument)
  }

  const notification = await prisma.notification.findFirst({
    where: {
      id: notificationId,
    },
    select: {
      id: true,
      title: true,
      content: true,
      messageEcid: true,
      actionRows: true,
      requiresTextResponse: true,
      acquireTopic: true,
      operationId: true,
      operation: {
        select: {
          status: true,
        },
      },
    },
  })

  if (notification === null) {
    throw new ConnectError(`Notification "${input.notificationId}" was not found`, Code.NotFound)
  }

  const nextActionRowsData = toNotificationActionRows(input.actionRows)
  const nextCallbackActionNames = getNotificationCallbackActionNames(nextActionRowsData)
  const nextRequiresTextResponse = input.requiresTextResponse ?? notification.requiresTextResponse
  const nextHasPendingResponse =
    nextCallbackActionNames.length > 0 ||
    nextRequiresTextResponse === true ||
    notification.acquireTopic === true
  const hasUrlActions = input.actionRows.some(row =>
    row.actions.some(action => action.url !== undefined),
  )
  const isNoopUpdate =
    notification.title === input.title &&
    notification.content === input.content &&
    JSON.stringify(notification.actionRows) === JSON.stringify(nextActionRowsData) &&
    notification.requiresTextResponse === nextRequiresTextResponse

  const shouldReplaceWaitOperation =
    notification.operationId !== null && notification.operation?.status === "PENDING"

  const deliveryConfig = await loadDeliveryConfig()
  const avatarToken =
    avatar === null ? undefined : await crypto.decrypt(encryptedStringSchema, avatar.tokenEcid)
  const effectiveAvatarToken =
    avatarToken ?? (isTelegramReplicaSender ? deliveryConfig.botToken : undefined)
  const botToken = effectiveAvatarToken ?? deliveryConfig.botToken
  const bot = createTelegramBotClient(botToken, {
    role: "notification.update",
  })
  const renderedTitle = await ecidSubstitutor.substituteInText(input.title)
  const renderedContent = await ecidSubstitutor.substituteInText(input.content)
  const renderedActionRows = await renderActionRowsForTelegram(ecidSubstitutor, input.actionRows)
  const replyMarkup = toInlineKeyboardMarkupFromActionRows(renderedActionRows)

  const messageText = toTelegramMessageTextValue(
    {
      title: renderedTitle,
      content: renderedContent,
    },
    senderDisplayTitle,
    avatar === null && !isTelegramReplicaSender,
  )

  const telegramMessage = await crypto.decrypt(telegramSentMessageSchema, notification.messageEcid)
  const targetChatId = getTelegramMessageChatId(telegramMessage)

  if (!(isNoopUpdate && !hasUrlActions)) {
    await bot.api.editMessageText(targetChatId, telegramMessage.message_id, messageText, {
      parse_mode: "HTML",
      link_preview_options: {
        is_disabled: true,
      },
      reply_markup: replyMarkup,
    })
  }

  const result = await prisma.$transaction(async tx => {
    if (shouldReplaceWaitOperation && notification.operationId !== null) {
      await tx.operation.update({
        where: {
          id: notification.operationId,
        },
        data: {
          status: "FAILED",
          failureReason: "NOTIFICATION_UPDATED",
          failureMessage: "Notification response requirements changed",
          resolvedAt: new Date(),
        },
      })
    }

    let nextOperationId: number | null = null

    if (
      nextHasPendingResponse &&
      !shouldReplaceWaitOperation &&
      notification.operationId !== null &&
      notification.operation?.status === "PENDING"
    ) {
      nextOperationId = notification.operationId
    }

    if (nextHasPendingResponse && nextOperationId === null) {
      const nextOperation = await tx.operation.create({
        data: {
          title: RESPONSE_OPERATION_TITLE,
          description: null,
        },
        select: {
          id: true,
        },
      })

      nextOperationId = nextOperation.id
    }

    await tx.notification.update({
      where: {
        id: notification.id,
      },
      data: {
        title: input.title,
        content: input.content,
        actionRows: nextActionRowsData,
        requiresTextResponse: nextRequiresTextResponse,
        operationId: nextOperationId,
      },
    })

    return {
      operationId: nextOperationId,
    }
  })

  return {
    operationId: result.operationId ?? undefined,
  }
}

export async function acceptNotificationResponseForReplica(
  _crypto: ResideCrypto,
  prisma: PrismaClient,
  _createTelegramBotClient: (token: string, args: { role: string }) => TelegramBotLike,
  _loadDeliveryConfig: () => Promise<{ botToken: string; systemChatId: string }>,
  input: { notificationId: string },
): Promise<{ operationId: number }> {
  const notificationId = parseNotificationId(input.notificationId)
  const notification = await prisma.notification.findUnique({
    where: {
      id: notificationId,
    },
    select: {
      id: true,
      messageEcid: true,
      requiresTextResponse: true,
      acquireTopic: true,
      operationId: true,
      sendAsSubjectId: true,
      operation: {
        select: {
          status: true,
        },
      },
    },
  })

  if (notification === null) {
    throw new ConnectError(`Notification "${input.notificationId}" was not found`, Code.NotFound)
  }

  if (!notification.requiresTextResponse && !notification.acquireTopic) {
    throw new ConnectError(
      `Notification "${input.notificationId}" does not accept responses`,
      Code.FailedPrecondition,
    )
  }

  if (notification.operationId !== null && notification.operation?.status === "PENDING") {
    return {
      operationId: notification.operationId,
    }
  }

  const result = await prisma.$transaction(async tx => {
    const current = await tx.notification.findUnique({
      where: {
        id: notification.id,
      },
      select: {
        operationId: true,
        operation: {
          select: {
            status: true,
          },
        },
      },
    })

    if (current === null) {
      throw new ConnectError(`Notification "${input.notificationId}" was not found`, Code.NotFound)
    }

    if (current?.operationId !== null && current?.operation?.status === "PENDING") {
      return {
        operationId: current.operationId,
      }
    }

    const operation = await tx.operation.create({
      data: {
        title: RESPONSE_OPERATION_TITLE,
        description: null,
      },
      select: {
        id: true,
      },
    })

    await tx.notification.update({
      where: {
        id: notification.id,
      },
      data: {
        operationId: operation.id,
      },
    })

    return {
      operationId: operation.id,
    }
  })

  return {
    operationId: result.operationId,
  }
}

export async function deleteNotificationForReplica(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  createTelegramBotClient: (token: string, args: { role: string }) => TelegramBotLike,
  loadDeliveryConfig: () => Promise<{ botToken: string; systemChatId: string }>,
  input: { notificationId: string },
): Promise<void> {
  const notificationId = parseNotificationId(input.notificationId)

  const notification = await prisma.notification.findFirst({
    where: {
      id: notificationId,
    },
    select: {
      id: true,
      messageEcid: true,
      sendAsSubjectId: true,
      operationId: true,
      operation: {
        select: {
          status: true,
        },
      },
    },
  })

  if (notification === null) {
    throw new ConnectError(`Notification "${input.notificationId}" was not found`, Code.NotFound)
  }

  const senderAvatar =
    notification.sendAsSubjectId === null
      ? null
      : await prisma.avatar.findUnique({
          where: {
            subjectId: notification.sendAsSubjectId,
          },
          select: {
            tokenEcid: true,
          },
        })

  const deliveryConfig = await loadDeliveryConfig()
  const senderAvatarToken =
    senderAvatar === null
      ? undefined
      : await crypto.decrypt(encryptedStringSchema, senderAvatar.tokenEcid)
  const botToken = senderAvatarToken ?? deliveryConfig.botToken
  const bot = createTelegramBotClient(botToken, {
    role: "notification.delete",
  })

  const telegramMessage = await crypto.decrypt(telegramSentMessageSchema, notification.messageEcid)
  await bot.api.deleteMessage(getTelegramMessageChatId(telegramMessage), telegramMessage.message_id)

  await prisma.$transaction(async tx => {
    if (notification.operationId !== null && notification.operation?.status === "PENDING") {
      await tx.operation.update({
        where: {
          id: notification.operationId,
        },
        data: {
          status: "FAILED",
          failureReason: "NOTIFICATION_DELETED",
          failureMessage: "Notification was deleted",
          resolvedAt: new Date(),
        },
      })
    }

    await tx.notification.delete({
      where: {
        id: notification.id,
      },
    })
  })
}

async function resolveNotificationTarget(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  input: {
    channelName?: string
    topicId?: string
    systemChatId: string
  },
): Promise<{
  channel: { id: number; name: string }
  target: NotificationChannelRoute
}> {
  if (input.topicId !== undefined && input.topicId.trim().length > 0) {
    const topicId = parseNotificationTopicId(input.topicId)
    const topic = await prisma.notificationTopic.findUnique({
      where: {
        id: topicId,
      },
      select: {
        id: true,
        threadEcid: true,
        channel: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    if (topic === null) {
      throw new ConnectError(`Topic "${input.topicId}" was not found`, Code.NotFound)
    }

    if (
      input.channelName !== undefined &&
      input.channelName.trim().length > 0 &&
      input.channelName !== topic.channel.name
    ) {
      throw new ConnectError(
        `Topic "${input.topicId}" belongs to another notification channel`,
        Code.InvalidArgument,
      )
    }

    const thread = await crypto.decrypt(telegramTopicThreadSchema, topic.threadEcid)

    return {
      channel: topic.channel,
      target: {
        chatId: thread.chat_id,
        messageThreadId: thread.message_thread_id,
        topicId: topic.id,
      },
    }
  }

  const channelName = input.channelName ?? ""
  assertChannelName(channelName)

  const channel = await prisma.notificationChannel.findUnique({
    where: {
      name: channelName,
    },
    select: {
      id: true,
      name: true,
    },
  })

  if (channel === null) {
    throw new ConnectError(`Channel with name "${channelName}" was not found`, Code.NotFound)
  }

  return {
    channel,
    target: await resolveNotificationChannelRoute(crypto, prisma, {
      channelId: channel.id,
      channelName: channel.name,
      systemChatId: input.systemChatId,
    }),
  }
}

export function parseNotificationId(notificationId: string): number {
  if (notificationId.length === 0) {
    throw new ConnectError("Notification id is required", Code.InvalidArgument)
  }

  const parsedNotificationId = Number(notificationId)
  if (!Number.isInteger(parsedNotificationId) || parsedNotificationId <= 0) {
    throw new ConnectError(`Invalid notification id "${notificationId}"`, Code.InvalidArgument)
  }

  return parsedNotificationId
}

async function renderActionRowsForTelegram(
  ecidSubstitutor: { substituteInText: (text: string) => Promise<string> },
  actionRows: ActionRow[],
): Promise<ActionRow[]> {
  const renderedRows: ActionRow[] = []

  for (const row of actionRows) {
    const renderedActions: ActionRow["actions"] = []

    for (const action of row.actions) {
      if (action.url === undefined) {
        renderedActions.push(action)
        continue
      }

      renderedActions.push({
        ...action,
        url: await ecidSubstitutor.substituteInText(action.url),
      })
    }

    renderedRows.push({
      actions: renderedActions,
    })
  }

  return renderedRows
}

function createTelegramMessageLink(
  chatId: string,
  messageId: number,
  messageThreadId?: number,
): string {
  const linkChatId = chatId.startsWith("-100") ? chatId.slice(4) : chatId

  if (messageThreadId !== undefined) {
    return `t.me/c/${linkChatId}/${messageThreadId}/${messageId}`
  }

  return `t.me/c/${linkChatId}/${messageId}`
}

export function assertActionRows(actions: Array<{ actions: Array<{ name: string }> }>): void {
  for (const row of actions) {
    for (const action of row.actions) {
      if (action.name.length === 0) {
        throw new ConnectError("Action name must not be empty", Code.InvalidArgument)
      }
    }
  }
}
