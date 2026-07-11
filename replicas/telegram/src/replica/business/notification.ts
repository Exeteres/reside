import type {
  NotificationJson,
  NotificationStatusJson,
  NotificationTaskStatusJson,
} from "@reside/api/interaction/notification.v1"
import type { ResideCrypto } from "@reside/common/encryption"
import type { PrismaClient } from "../../database"
import type {
  ActionRow,
  AuthzServiceClientLike,
  NotificationStatus,
  NotificationTaskGroupInput,
  SendNotificationInput,
  SubjectServiceClientLike,
  TelegramBotLike,
  UpdateNotificationInput,
} from "./notification-types"
import { Code, ConnectError } from "@connectrpc/connect"
import { rhid } from "@reside/common"
import { OperationType } from "../../database"
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
import { replaceSubjectIdsWithTitles } from "./subject-display"

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
): Promise<{
  notificationId: string
  operationId: number | undefined
  messageLink?: string
  notification?: NotificationJson
}> {
  const ecidSubstitutor = createEcidTextSubstitutor(crypto)

  if (input.topicId === undefined) {
    assertChannelName(input.channel ?? "")
  }

  assertActionRows(input.actionRows)
  const notificationStatus = input.status ?? "REGULAR"
  const taskGroups = input.taskGroups ?? []
  assertTaskGroups(notificationStatus, taskGroups)
  assertResponseMode({
    acquireTopic: input.acquireTopic === true,
    acceptedDiceEmojis: input.acceptedDiceEmojis ?? [],
    protectedForSubjectId: input.protectedForSubjectId,
  })

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
    callbackActions.length > 0 ||
    input.requiresTextResponse === true ||
    input.acquireTopic === true ||
    (input.acceptedDiceEmojis?.length ?? 0) > 0

  const avatar = await prisma.avatar.findUnique({
    where: {
      subjectId: senderSubjectId,
    },
    select: {
      tokenEcid: true,
    },
  })

  const isTelegramReplicaSender = senderSubjectId === TELEGRAM_REPLICA_SUBJECT_ID

  const renderedTitle = await renderTextForTelegram(
    crypto,
    prisma,
    subjectService,
    ecidSubstitutor,
    input.title,
  )
  const renderedContent = await renderTextForTelegram(
    crypto,
    prisma,
    subjectService,
    ecidSubstitutor,
    input.content ?? "",
  )
  const renderedActionRows = await renderActionRowsForTelegram(
    crypto,
    prisma,
    subjectService,
    ecidSubstitutor,
    input.actionRows,
  )
  const renderedTaskGroups = await renderTaskGroupsForTelegram(
    crypto,
    prisma,
    subjectService,
    ecidSubstitutor,
    taskGroups,
  )

  const messageText = toTelegramMessageText(
    {
      title: renderedTitle,
      content: renderedContent,
      status: notificationStatus,
      taskGroups: renderedTaskGroups,
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
  const replyMarkup = toInlineKeyboardMarkupFromActionRows(renderedActionRows, {
    status: notificationStatus,
  })
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
          stickerFileId: input.stickerFileId,
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
            stickerFileId: input.stickerFileId,
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
        status: notificationStatus,
        actionRows,
        taskGroups: createTaskGroupNestedWrites(taskGroups),
        requiresTextResponse: input.requiresTextResponse === true,
        isProtected: input.protected === true,
        protectedForSubjectId: input.protectedForSubjectId,
        expectImmediateFeedback: input.expectImmediateFeedback === true,
        acquireTopic: input.acquireTopic === true,
        acceptedDiceEmojis: input.acceptedDiceEmojis ?? [],
      },
      select: {
        id: true,
      },
    })

    return {
      notificationId: String(notification.id),
      operationId: undefined,
      messageLink: messageLinkEcid,
      notification: await getNotificationReadModelIfAvailable(prisma, notification.id),
    }
  }

  const operationResult = await prisma.$transaction(async tx => {
    const operation = await tx.operation.create({
      data: {
        title: RESPONSE_OPERATION_TITLE,
        description: null,
        type: OperationType.NOTIFICATION_RESPONSE,
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
        status: notificationStatus,
        actionRows,
        taskGroups: createTaskGroupNestedWrites(taskGroups),
        requiresTextResponse: input.requiresTextResponse === true,
        isProtected: input.protected === true,
        protectedForSubjectId: input.protectedForSubjectId,
        expectImmediateFeedback: input.expectImmediateFeedback === true,
        acquireTopic: input.acquireTopic === true,
        acceptedDiceEmojis: input.acceptedDiceEmojis ?? [],
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
    notification: await getNotificationReadModelIfAvailable(prisma, operationResult.notificationId),
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
): Promise<{ operationId: number | undefined; notification?: NotificationJson }> {
  const ecidSubstitutor = createEcidTextSubstitutor(crypto)

  const notificationId = parseNotificationId(input.notificationId)
  assertActionRows(input.actionRows)
  const notificationStatus = input.status ?? "REGULAR"
  const taskGroups = input.taskGroups ?? []
  assertTaskGroups(notificationStatus, taskGroups)

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
      status: true,
      messageEcid: true,
      actionRows: true,
      requiresTextResponse: true,
      protectedForSubjectId: true,
      expectImmediateFeedback: true,
      acquireTopic: true,
      acceptedDiceEmojis: true,
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
  const nextExpectImmediateFeedback =
    input.expectImmediateFeedback ?? notification.expectImmediateFeedback
  const nextProtectedForSubjectId =
    input.protectedForSubjectId ?? notification.protectedForSubjectId
  const nextAcceptedDiceEmojis = input.acceptedDiceEmojis ?? notification.acceptedDiceEmojis ?? []
  const nextAcquireTopic = input.acquireTopic ?? notification.acquireTopic
  assertResponseMode({
    acquireTopic: nextAcquireTopic,
    acceptedDiceEmojis: nextAcceptedDiceEmojis,
    protectedForSubjectId: nextProtectedForSubjectId,
  })
  const nextHasPendingResponse =
    nextCallbackActionNames.length > 0 ||
    nextRequiresTextResponse === true ||
    nextAcquireTopic === true ||
    nextAcceptedDiceEmojis.length > 0
  const hasUrlActions = input.actionRows.some(row =>
    row.actions.some(action => action.url !== undefined),
  )
  const isNoopUpdate =
    notification.title === input.title &&
    notification.content === input.content &&
    notification.status === notificationStatus &&
    JSON.stringify(notification.actionRows) === JSON.stringify(nextActionRowsData) &&
    notification.requiresTextResponse === nextRequiresTextResponse &&
    notification.protectedForSubjectId === nextProtectedForSubjectId &&
    notification.expectImmediateFeedback === nextExpectImmediateFeedback &&
    notification.acquireTopic === nextAcquireTopic &&
    JSON.stringify(notification.acceptedDiceEmojis) === JSON.stringify(nextAcceptedDiceEmojis) &&
    JSON.stringify(await getNotificationTaskGroups(prisma, notification.id)) ===
      JSON.stringify(taskGroups)

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
  const renderedTitle = await renderTextForTelegram(
    crypto,
    prisma,
    subjectService,
    ecidSubstitutor,
    input.title,
  )
  const renderedContent = await renderTextForTelegram(
    crypto,
    prisma,
    subjectService,
    ecidSubstitutor,
    input.content,
  )
  const renderedActionRows = await renderActionRowsForTelegram(
    crypto,
    prisma,
    subjectService,
    ecidSubstitutor,
    input.actionRows,
  )
  const renderedTaskGroups = await renderTaskGroupsForTelegram(
    crypto,
    prisma,
    subjectService,
    ecidSubstitutor,
    taskGroups,
  )
  const replyMarkup = toInlineKeyboardMarkupFromActionRows(renderedActionRows, {
    status: notificationStatus,
  })

  const messageText = toTelegramMessageTextValue(
    {
      title: renderedTitle,
      content: renderedContent,
      status: notificationStatus,
      taskGroups: renderedTaskGroups,
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
          type: OperationType.NOTIFICATION_RESPONSE,
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
        status: notificationStatus,
        actionRows: nextActionRowsData,
        taskGroups: {
          deleteMany: {},
          create: createTaskGroupNestedWrites(taskGroups).create,
        },
        requiresTextResponse: nextRequiresTextResponse,
        protectedForSubjectId: nextProtectedForSubjectId,
        expectImmediateFeedback: nextExpectImmediateFeedback,
        acquireTopic: nextAcquireTopic,
        acceptedDiceEmojis: nextAcceptedDiceEmojis,
        operationId: nextOperationId,
      },
    })

    return {
      operationId: nextOperationId,
    }
  })

  return {
    operationId: result.operationId ?? undefined,
    notification: await getNotificationReadModelIfAvailable(prisma, notification.id),
  }
}

export async function acceptNotificationResponseForReplica(
  _crypto: ResideCrypto,
  prisma: PrismaClient,
  _createTelegramBotClient: (token: string, args: { role: string }) => TelegramBotLike,
  _loadDeliveryConfig: () => Promise<{ botToken: string; systemChatId: string }>,
  input: { notificationId: string },
): Promise<{ operationId: number; notification?: NotificationJson }> {
  const notificationId = parseNotificationId(input.notificationId)
  const notification = await prisma.notification.findUnique({
    where: {
      id: notificationId,
    },
    select: {
      id: true,
      messageEcid: true,
      requiresTextResponse: true,
      actionRows: true,
      acquireTopic: true,
      acceptedDiceEmojis: true,
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

  if (
    collectCallbackActions(toActionRowsFromData(notification.actionRows)).length === 0 &&
    !notification.requiresTextResponse &&
    !notification.acquireTopic &&
    notification.acceptedDiceEmojis.length === 0
  ) {
    throw new ConnectError(
      `Notification "${input.notificationId}" does not accept responses`,
      Code.FailedPrecondition,
    )
  }

  if (notification.operationId !== null && notification.operation?.status === "PENDING") {
    return {
      operationId: notification.operationId,
      notification: await getNotificationReadModelIfAvailable(prisma, notification.id),
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
        type: OperationType.NOTIFICATION_RESPONSE,
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
    notification: await getNotificationReadModelIfAvailable(prisma, notification.id),
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

export async function getNotificationReadModel(
  prisma: PrismaClient,
  notificationId: number,
): Promise<NotificationJson> {
  const notification = await prisma.notification.findUnique({
    where: {
      id: notificationId,
    },
    select: {
      id: true,
      title: true,
      content: true,
      status: true,
      actionRows: true,
      requiresTextResponse: true,
      isProtected: true,
      expectImmediateFeedback: true,
      acquireTopic: true,
      acceptedDiceEmojis: true,
      protectedForSubjectId: true,
      taskGroups: {
        orderBy: {
          position: "asc",
        },
        select: {
          stableId: true,
          title: true,
          tasks: {
            orderBy: {
              position: "asc",
            },
            select: {
              stableId: true,
              title: true,
              status: true,
            },
          },
        },
      },
    },
  })

  if (!notification) {
    throw new ConnectError(`Notification "${notificationId}" was not found`, Code.NotFound)
  }

  if (
    typeof notification.title !== "string" ||
    typeof notification.content !== "string" ||
    typeof notification.status !== "string" ||
    typeof notification.requiresTextResponse !== "boolean" ||
    typeof notification.isProtected !== "boolean" ||
    typeof notification.expectImmediateFeedback !== "boolean" ||
    typeof notification.acquireTopic !== "boolean" ||
    !Array.isArray(notification.acceptedDiceEmojis)
  ) {
    throw new ConnectError(
      `Notification "${notificationId}" read model is incomplete`,
      Code.NotFound,
    )
  }

  const result: NotificationJson = {
    notificationId: String(notification.id),
    title: notification.title,
    content: notification.content,
    status: toNotificationStatusJson(notification.status),
    actionRows: toActionRowsFromData(notification.actionRows),
    taskGroups: (notification.taskGroups ?? []).map(group => ({
      id: group.stableId,
      title: group.title,
      tasks: group.tasks.map(task => ({
        id: task.stableId,
        title: task.title,
        status: toNotificationTaskStatusJson(task.status),
      })),
    })),
    requiresTextResponse: notification.requiresTextResponse,
    protected: notification.isProtected,
    expectImmediateFeedback: notification.expectImmediateFeedback,
    acquireTopic: notification.acquireTopic,
    acceptedDiceEmojis: notification.acceptedDiceEmojis,
  }

  if (notification.protectedForSubjectId !== null) {
    result.protectedForSubjectId = notification.protectedForSubjectId
  }

  return result
}

async function getNotificationReadModelIfAvailable(
  prisma: PrismaClient,
  notificationId: number,
): Promise<NotificationJson | undefined> {
  try {
    return await getNotificationReadModel(prisma, notificationId)
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      return undefined
    }

    throw error
  }
}

async function getNotificationTaskGroups(
  prisma: PrismaClient,
  notificationId: number,
): Promise<NotificationTaskGroupInput[]> {
  const taskGroups = await prisma.notificationTaskGroup.findMany({
    where: {
      notificationId,
    },
    orderBy: {
      position: "asc",
    },
    select: {
      stableId: true,
      title: true,
      tasks: {
        orderBy: {
          position: "asc",
        },
        select: {
          stableId: true,
          title: true,
          status: true,
        },
      },
    },
  })

  return taskGroups.map(group => ({
    id: group.stableId,
    title: group.title,
    tasks: group.tasks.map(task => ({
      id: task.stableId,
      title: task.title,
      status: task.status,
    })),
  }))
}

function createTaskGroupNestedWrites(taskGroups: NotificationTaskGroupInput[]): {
  create: {
    stableId: string
    title: string
    position: number
    tasks: {
      create: {
        stableId: string
        title: string
        status: NotificationTaskGroupInput["tasks"][number]["status"]
        position: number
      }[]
    }
  }[]
} {
  return {
    create: taskGroups.map((group, groupIndex) => ({
      stableId: group.id,
      title: group.title,
      position: groupIndex,
      tasks: {
        create: group.tasks.map((task, taskIndex) => ({
          stableId: task.id,
          title: task.title,
          status: task.status,
          position: taskIndex,
        })),
      },
    })),
  }
}

function toActionRowsFromData(
  actionRows: PrismaJson.NotificationActionRowsData | undefined,
): ActionRow[] {
  return (actionRows ?? []).map(row => ({
    actions: (row.actions ?? []).flatMap(action => {
      if (typeof action.name !== "string" || typeof action.title !== "string") {
        return []
      }

      return [
        {
          name: action.name,
          title: action.title,
          ...(typeof action.url === "string" ? { url: action.url } : {}),
        },
      ]
    }),
  }))
}

function assertTaskGroups(
  status: NotificationStatus,
  taskGroups: NotificationTaskGroupInput[],
): void {
  const groupIds = new Set<string>()

  for (const group of taskGroups) {
    if (group.id.length === 0) {
      throw new ConnectError("Task group id must not be empty", Code.InvalidArgument)
    }

    if (group.title.length === 0) {
      throw new ConnectError("Task group title must not be empty", Code.InvalidArgument)
    }

    if (groupIds.has(group.id)) {
      throw new ConnectError(`Duplicate task group id "${group.id}"`, Code.InvalidArgument)
    }

    groupIds.add(group.id)
    assertTasks(status, group)
  }

  if (status === "PLANNING" && !taskGroups.some(group => group.tasks.length > 0)) {
    throw new ConnectError(
      "Planning notification must include at least one task",
      Code.InvalidArgument,
    )
  }
}

function assertResponseMode(input: {
  acquireTopic: boolean
  acceptedDiceEmojis: string[]
  protectedForSubjectId?: string | null
}): void {
  if (input.acceptedDiceEmojis.length === 0) {
    return
  }

  if (input.acquireTopic) {
    throw new ConnectError(
      "Dice responses cannot be combined with topic acquisition",
      Code.InvalidArgument,
    )
  }

  if (input.protectedForSubjectId == null || input.protectedForSubjectId.length === 0) {
    throw new ConnectError("Dice responses must be protected for a subject", Code.InvalidArgument)
  }
}

function assertTasks(status: NotificationStatus, group: NotificationTaskGroupInput): void {
  const taskIds = new Set<string>()

  for (const task of group.tasks) {
    if (task.id.length === 0) {
      throw new ConnectError("Task id must not be empty", Code.InvalidArgument)
    }

    if (task.title.length === 0) {
      throw new ConnectError("Task title must not be empty", Code.InvalidArgument)
    }

    if (taskIds.has(task.id)) {
      throw new ConnectError(
        `Duplicate task id "${task.id}" in group "${group.id}"`,
        Code.InvalidArgument,
      )
    }

    taskIds.add(task.id)

    if (status === "PLANNING" && task.status !== "PLANNED" && task.status !== "SKIPPED") {
      throw new ConnectError(
        "Planning notification tasks must be planned or skipped",
        Code.InvalidArgument,
      )
    }
  }
}

function toNotificationStatusJson(status: NotificationStatus): NotificationStatusJson {
  switch (status) {
    case "PLANNING":
      return "NOTIFICATION_STATUS_PLANNING"
    case "IN_PROGRESS":
      return "NOTIFICATION_STATUS_IN_PROGRESS"
    case "COMPLETED":
      return "NOTIFICATION_STATUS_COMPLETED"
    case "FAILED":
      return "NOTIFICATION_STATUS_FAILED"
    case "REGULAR":
      return "NOTIFICATION_STATUS_REGULAR"
  }
}

function toNotificationTaskStatusJson(
  status: NotificationTaskGroupInput["tasks"][number]["status"],
): NotificationTaskStatusJson {
  switch (status) {
    case "PENDING":
      return "NOTIFICATION_TASK_STATUS_PENDING"
    case "IN_PROGRESS":
      return "NOTIFICATION_TASK_STATUS_IN_PROGRESS"
    case "COMPLETED":
      return "NOTIFICATION_TASK_STATUS_COMPLETED"
    case "FAILED":
      return "NOTIFICATION_TASK_STATUS_FAILED"
    case "SKIPPED":
      return "NOTIFICATION_TASK_STATUS_SKIPPED"
    case "PLANNED":
      return "NOTIFICATION_TASK_STATUS_PLANNED"
  }
}

async function renderActionRowsForTelegram(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  subjectService: SubjectServiceClientLike,
  ecidSubstitutor: { substituteInText: (text: string) => Promise<string> },
  actionRows: ActionRow[],
): Promise<ActionRow[]> {
  const renderedRows: ActionRow[] = []

  for (const row of actionRows) {
    const renderedActions: ActionRow["actions"] = []

    for (const action of row.actions) {
      const title = await renderTextForTelegram(
        crypto,
        prisma,
        subjectService,
        ecidSubstitutor,
        action.title,
      )

      if (action.url === undefined) {
        renderedActions.push({ ...action, title })
        continue
      }

      renderedActions.push({
        ...action,
        title,
        url: await renderTextForTelegram(
          crypto,
          prisma,
          subjectService,
          ecidSubstitutor,
          action.url,
        ),
      })
    }

    renderedRows.push({
      actions: renderedActions,
    })
  }

  return renderedRows
}

async function renderTaskGroupsForTelegram(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  subjectService: SubjectServiceClientLike,
  ecidSubstitutor: { substituteInText: (text: string) => Promise<string> },
  taskGroups: NotificationTaskGroupInput[],
): Promise<NotificationTaskGroupInput[]> {
  const renderedGroups: NotificationTaskGroupInput[] = []

  for (const group of taskGroups) {
    const renderedTasks = []

    for (const task of group.tasks) {
      renderedTasks.push({
        ...task,
        title: await renderTextForTelegram(
          crypto,
          prisma,
          subjectService,
          ecidSubstitutor,
          task.title,
        ),
      })
    }

    renderedGroups.push({
      ...group,
      title: await renderTextForTelegram(
        crypto,
        prisma,
        subjectService,
        ecidSubstitutor,
        group.title,
      ),
      tasks: renderedTasks,
    })
  }

  return renderedGroups
}

async function renderTextForTelegram(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  subjectService: SubjectServiceClientLike,
  ecidSubstitutor: { substituteInText: (text: string) => Promise<string> },
  text: string,
): Promise<string> {
  const ecidRenderedText = await ecidSubstitutor.substituteInText(text)
  return await replaceSubjectIdsWithTitles(crypto, prisma, subjectService, ecidRenderedText)
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

export function assertActionRows(actions: { actions: { name: string }[] }[]): void {
  for (const row of actions) {
    for (const action of row.actions) {
      if (action.name.length === 0) {
        throw new ConnectError("Action name must not be empty", Code.InvalidArgument)
      }
    }
  }
}
