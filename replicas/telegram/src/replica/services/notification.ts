import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type { SubjectServiceClient } from "@reside/api/common/subject.v1"
import type { NotificationServiceImplementation } from "@reside/api/interaction/notification.v1"
import type { InlineKeyboardMarkup, InputMediaDocument, InputMediaPhoto } from "grammy/types"
import type { Operation, PrismaClient } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"
import { CoreV1Api } from "@kubernetes/client-node"
import {
  authenticateReplica,
  block,
  bold,
  type CommonServices,
  type GenericOperationService,
  getReplicaNamespace,
  kubeConfig,
  logger,
} from "@reside/common"
import { WellKnownPermissions } from "@reside/registry"
import { type Bot, GrammyError, InputFile } from "grammy"
import { TelegramNotificationChannels } from "../../definitions"
import { strings } from "../../locale"
import { decryptInteractionContextToken } from "../../shared"
import { createTelegramBotClient } from "../bot-client"
import {
  loadTelegramConfigState,
  TELEGRAM_CONFIG_MAP_NAME,
  TELEGRAM_SYSTEM_CHAT_ID_KEY,
} from "../config"
import { loadTelegramSecretState, TELEGRAM_SECRET_NAME } from "../secret"

const RESPONSE_OPERATION_TITLE = strings.server.notification.responseOperationTitle

export function createNotificationService({
  prisma,
  authzService,
  subjectService,
  operationService,
}: CommonServices<"access"> & {
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
}): NotificationServiceImplementation {
  const namespace = getReplicaNamespace()
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)

  return {
    async sendNotification(request, context) {
      const { name: replicaName } = await authenticateReplica(context)
      logger.info(
        "sendNotification requested by replica %s for channel %s",
        replicaName,
        request.channel,
      )
      assertChannelName(request.channel)
      const replicaSubjectId = `replica:${replicaName}`
      const senderSubjectId = await resolveSenderSubjectId({
        authzService,
        callerSubjectId: replicaSubjectId,
        requestedSubjectId: request.sendAsSubjectId,
      })

      const senderDisplayTitle = await resolveSenderDisplayTitle(
        subjectService,
        senderSubjectId,
        senderSubjectId,
      )

      const channel = await prisma.notificationChannel.findUnique({
        where: {
          name: request.channel,
        },
      })

      if (!channel) {
        throw new ConnectError(
          `Channel with name "${request.channel}" was not found`,
          Code.NotFound,
        )
      }

      assertActionRows(request.actionRows)
      const callbackActions = collectCallbackActions(request.actionRows)

      const hasPendingResponse = callbackActions.length > 0 || request.requiresTextResponse === true
      const avatar = await prisma.avatar.findUnique({
        where: {
          subjectId: senderSubjectId,
        },
        select: {
          token: true,
        },
      })
      const messageText = toTelegramMessageText(request, senderDisplayTitle, avatar === null)
      logger.debug(
        "prepared telegram notification payload for channel %s (pendingResponse=%s)",
        request.channel,
        hasPendingResponse,
      )

      try {
        const deliveryConfig = await loadDeliveryConfig(coreApi, namespace)
        const interactionContext = await parseInteractionContextToken(
          request.contextToken,
          deliveryConfig.systemChatId,
        )
        const botToken = avatar?.token ?? deliveryConfig.botToken
        const bot = createTelegramBotClient(botToken, {
          role: "notification.send",
        })
        const replyMarkup = toInlineKeyboardMarkup(request)
        const targetChatId = interactionContext.chatId
        const replyToMessageId = interactionContext.messageId
        const isAvatarSender = avatar?.token !== null && avatar?.token !== undefined

        await ensureTargetChatExists(prisma, targetChatId)

        let sentMessageId: number
        let usedReplyFallback = false

        try {
          sentMessageId = await sendNotificationPayload(
            bot,
            targetChatId,
            request,
            messageText,
            replyMarkup,
            replyToMessageId,
          )
        } catch (error) {
          if (
            isAvatarSender &&
            replyToMessageId !== undefined &&
            isReplyTargetMessageMissingError(error)
          ) {
            usedReplyFallback = true

            logger.warn(
              {
                targetChatId,
                replyToMessageId,
                senderSubjectId,
              },
              "avatar bot reply target message was not found, retrying without reply target",
            )

            sentMessageId = await sendNotificationPayload(
              bot,
              targetChatId,
              request,
              messageText,
              replyMarkup,
              undefined,
            )
          } else {
            throw error
          }
        }

        if (usedReplyFallback) {
          await sendAvatarPrivacyModeWarning({
            prisma,
            botToken: deliveryConfig.botToken,
            targetChatId,
            callingSubjectId: replicaSubjectId,
            sendAsSubjectId: senderSubjectId,
          })
        }

        if (!hasPendingResponse) {
          const notification = await prisma.notification.create({
            data: {
              operationId: null,
              targetChatId,
              replyToMessageId,
              channelId: channel.id,
              messageId: sentMessageId,
              callingSubjectId: replicaSubjectId,
              sendAsSubjectId: senderSubjectId,
              title: request.title,
              content: request.content ?? "",
              allowedActions: callbackActions.map(action => action.name),
              requiresTextResponse: request.requiresTextResponse === true,
              isProtected: request.protected === true,
            },
            select: {
              id: true,
            },
          })

          logger.info({ channel: request.channel }, "telegram notification sent")

          return {
            notificationId: String(notification.id),
            operation: undefined,
          }
        }

        const operationResult = await prisma.$transaction(async tx => {
          const operation = await tx.operation.create({
            data: {
              title: RESPONSE_OPERATION_TITLE,
              description: null,
            },
          })

          const notification = await tx.notification.create({
            data: {
              operationId: operation.id,
              targetChatId,
              replyToMessageId,
              channelId: channel.id,
              messageId: sentMessageId,
              callingSubjectId: replicaSubjectId,
              sendAsSubjectId: senderSubjectId,
              title: request.title,
              content: request.content ?? "",
              allowedActions: callbackActions.map(action => action.name),
              requiresTextResponse: request.requiresTextResponse === true,
              isProtected: request.protected === true,
            },
            select: {
              id: true,
            },
          })

          return {
            operation,
            notification,
          }
        })

        logger.info(
          {
            channel: request.channel,
            operationId: operationResult.operation.id,
          },
          "telegram notification sent with pending response operation",
        )

        return {
          notificationId: String(operationResult.notification.id),
          operation: await operationService.toApiOperation(operationResult.operation.id),
        }
      } catch (error) {
        logger.error({ error }, "failed to send telegram notification")

        throw new ConnectError("Failed to send telegram notification", Code.Internal)
      }
    },

    async updateNotification(request, context) {
      const { name: replicaName } = await authenticateReplica(context)
      logger.info(
        "updateNotification requested by replica %s for notificationId %s",
        replicaName,
        request.notificationId,
      )
      const notificationId = parseNotificationId(request.notificationId)
      assertActionNames(request.actions)
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
          token: true,
        },
      })

      if (request.title.length === 0) {
        throw new ConnectError("Notification title must not be empty", Code.InvalidArgument)
      }

      const notification = await prisma.notification.findFirst({
        where: {
          id: notificationId,
        },
        select: {
          id: true,
          messageId: true,
          targetChatId: true,
          allowedActions: true,
          requiresTextResponse: true,
          operationId: true,
          operation: {
            select: {
              status: true,
            },
          },
        },
      })

      if (notification === null) {
        throw new ConnectError(
          `Notification "${request.notificationId}" was not found`,
          Code.NotFound,
        )
      }

      const nextAllowedActions = request.actions
        .filter(action => action.url === undefined)
        .map(action => action.name)
      const nextRequiresTextResponse =
        request.requiresTextResponse ?? notification.requiresTextResponse
      const nextHasPendingResponse =
        nextAllowedActions.length > 0 || nextRequiresTextResponse === true

      const shouldReplaceWaitOperation =
        notification.operationId !== null && notification.operation?.status === "PENDING"

      try {
        const deliveryConfig = await loadDeliveryConfig(coreApi, namespace)
        const botToken = avatar?.token ?? deliveryConfig.botToken
        const bot = createTelegramBotClient(botToken, {
          role: "notification.update",
        })
        const replyMarkup = toInlineKeyboardMarkupFromActions(request.actions)
        const targetChatId = notification.targetChatId

        const messageText = toTelegramMessageTextValue(
          {
            title: request.title,
            content: request.content,
          },
          senderDisplayTitle,
          avatar === null,
        )

        await bot.api.editMessageText(targetChatId, notification.messageId, messageText, {
          parse_mode: "HTML",
          link_preview_options: {
            is_disabled: true,
          },
          reply_markup: replyMarkup,
        })

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
              title: request.title,
              content: request.content,
              allowedActions: nextAllowedActions,
              requiresTextResponse: nextRequiresTextResponse,
              operationId: nextOperationId,
            },
          })

          return {
            operationId: nextOperationId,
          }
        })

        if (result.operationId === null) {
          return {
            operation: undefined,
          }
        }

        return {
          operation: await operationService.toApiOperation(result.operationId),
        }
      } catch (error) {
        logger.error({ error }, "failed to update telegram notification")

        throw new ConnectError("Failed to update telegram notification", Code.Internal)
      }
    },
  }
}

async function resolveSenderSubjectId(args: {
  authzService: AuthzServiceClient
  callerSubjectId: string
  requestedSubjectId: string | undefined
}): Promise<string> {
  if (args.requestedSubjectId === undefined) {
    return args.callerSubjectId
  }

  const requestedSubjectId = args.requestedSubjectId.trim()
  if (requestedSubjectId.length === 0) {
    throw new ConnectError("sendAsSubjectId must not be empty", Code.InvalidArgument)
  }

  if (requestedSubjectId === args.callerSubjectId) {
    return requestedSubjectId
  }

  const permissionCheck = await args.authzService.checkPermission({
    permissionName: WellKnownPermissions.TELEGRAM_NOTIFICATION_SEND_AS_SUBJECT,
    subjectId: args.callerSubjectId,
    scope: requestedSubjectId,
  })

  if (!permissionCheck.authorized) {
    throw new ConnectError(
      `Subject "${args.callerSubjectId}" is not allowed to send notifications as subject "${requestedSubjectId}"`,
      Code.PermissionDenied,
    )
  }

  return requestedSubjectId
}

function assertActionNames(actions: Array<{ name: string }>): void {
  for (const action of actions) {
    if (action.name.length === 0) {
      throw new ConnectError("Action name must not be empty", Code.InvalidArgument)
    }
  }
}

function assertActionRows(actions: Array<{ actions: Array<{ name: string }> }>): void {
  for (const row of actions) {
    assertActionNames(row.actions)
  }
}

function collectCallbackActions(
  actionRows: Array<{ actions: Array<{ name: string; title: string; url?: string }> }>,
): Array<{ name: string; title: string }> {
  return actionRows.flatMap(row =>
    row.actions
      .filter(action => action.url === undefined)
      .map(action => ({
        name: action.name,
        title: action.title,
      })),
  )
}

async function parseInteractionContextToken(
  token: string | undefined,
  systemChatId: string,
): Promise<{
  chatId: string
  messageId: number | undefined
}> {
  if (token === undefined || token.trim().length === 0) {
    return {
      chatId: systemChatId,
      messageId: undefined,
    }
  }

  try {
    const context = await decryptInteractionContextToken(token)

    return {
      chatId: context.chat_id,
      messageId: context.message_id,
    }
  } catch (error) {
    throw new ConnectError(
      `Invalid context token: ${error instanceof Error ? error.message : String(error)}`,
      Code.InvalidArgument,
    )
  }
}

async function ensureTargetChatExists(prisma: PrismaClient, targetChatId: string): Promise<void> {
  await prisma.chat.upsert({
    where: {
      telegramId: targetChatId,
    },
    create: {
      telegramId: targetChatId,
      data: {} as unknown as PrismaJson.ChatData,
    },
    update: {},
    select: {
      id: true,
    },
  })
}

function parseNotificationId(notificationId: string): number {
  if (notificationId.length === 0) {
    throw new ConnectError("Notification id is required", Code.InvalidArgument)
  }

  const parsedNotificationId = Number(notificationId)
  if (!Number.isInteger(parsedNotificationId) || parsedNotificationId <= 0) {
    throw new ConnectError(`Invalid notification id "${notificationId}"`, Code.InvalidArgument)
  }

  return parsedNotificationId
}

function assertChannelName(channelName: string): void {
  if (channelName.length > 0) {
    return
  }

  throw new ConnectError("Channel name must not be empty", Code.InvalidArgument)
}

async function loadDeliveryConfig(
  coreApi: CoreV1Api,
  namespace: string,
): Promise<{ botToken: string; systemChatId: string }> {
  const secretState = await loadTelegramSecretState(coreApi, namespace)
  const configState = await loadTelegramConfigState(coreApi, namespace)

  if (!secretState.botToken) {
    throw new ConnectError(
      `Secret "${TELEGRAM_SECRET_NAME}" must contain "bot_token"`,
      Code.FailedPrecondition,
    )
  }

  if (!configState.systemChatId) {
    throw new ConnectError(
      `ConfigMap "${TELEGRAM_CONFIG_MAP_NAME}" must contain "${TELEGRAM_SYSTEM_CHAT_ID_KEY}"`,
      Code.FailedPrecondition,
    )
  }

  return {
    botToken: secretState.botToken,
    systemChatId: configState.systemChatId,
  }
}

function toTelegramMessageText(
  request: {
    title: string
    content?: string
  },
  senderTitle: string,
  includeSenderTitle: boolean,
): string {
  return toTelegramMessageTextValue(
    {
      title: request.title,
      content: request.content,
    },
    senderTitle,
    includeSenderTitle,
  )
}

function toTelegramMessageTextValue(
  input: {
    title: string
    content: string | undefined
  },
  senderTitle: string,
  includeSenderTitle: boolean,
): string {
  const content = input.content?.trim()

  if (includeSenderTitle) {
    if (content) {
      return block(bold(senderTitle), "", bold(input.title), "", { html: content }).html
    }

    return block(bold(senderTitle), "", bold(input.title)).html
  }

  if (content) {
    return block(bold(input.title), "", { html: content }).html
  }

  return block(bold(input.title)).html
}

async function resolveSenderDisplayTitle(
  accessSubjectService: SubjectServiceClient,
  subjectId: string,
  fallbackTitle: string,
): Promise<string> {
  try {
    const displayInfo = await accessSubjectService.getSubjectDisplayInfo({
      subjectId,
    })

    if (displayInfo.title.length > 0) {
      return displayInfo.title
    }

    return fallbackTitle
  } catch (error) {
    logger.warn({ error, subjectId }, "failed to resolve sender display title through access")
    return fallbackTitle
  }
}

function toInlineKeyboardMarkup(request: {
  actionRows: Array<{
    actions: Array<{ name: string; title: string; url?: string }>
  }>
}): InlineKeyboardMarkup | undefined {
  return toInlineKeyboardMarkupFromActionRows(request.actionRows)
}

function toInlineKeyboardMarkupFromActionRows(
  actionRows: Array<{
    actions: Array<{ name: string; title: string; url?: string }>
  }>,
): InlineKeyboardMarkup | undefined {
  const rows = actionRows
    .map(row =>
      row.actions.map(action => {
        if (action.url !== undefined) {
          return {
            text: action.title,
            url: action.url,
          }
        }

        return {
          text: action.title,
          callback_data: action.name,
        }
      }),
    )
    .filter(row => row.length > 0)

  if (rows.length === 0) {
    return undefined
  }

  return {
    inline_keyboard: rows,
  }
}

function toInlineKeyboardMarkupFromActions(
  actions: Array<{ name: string; title: string; url?: string }>,
): InlineKeyboardMarkup | undefined {
  const rows = actions.map(action => {
    if (action.url !== undefined) {
      return [
        {
          text: action.title,
          url: action.url,
        },
      ]
    }

    return [
      {
        text: action.title,
        callback_data: action.name,
      },
    ]
  })

  if (rows.length === 0) {
    return undefined
  }

  return {
    inline_keyboard: rows,
  }
}

async function sendNotificationPayload(
  bot: Bot,
  chatId: string,
  request: {
    images: Array<{ content: Uint8Array; name: string }>
    attachments: Array<{ content: Uint8Array; name: string }>
  },
  messageText: string,
  replyMarkup: InlineKeyboardMarkup | undefined,
  replyToMessageId: number | undefined,
): Promise<number> {
  if (request.images.length === 0) {
    const sentMessage = await bot.api.sendMessage(chatId, messageText, {
      parse_mode: "HTML",
      link_preview_options: {
        is_disabled: true,
      },
      reply_markup: replyMarkup,
      reply_parameters: toReplyParameters(replyToMessageId),
    })

    if (request.attachments.length > 0) {
      await sendAttachmentGroup(bot, chatId, request.attachments, replyToMessageId)
    }

    return sentMessage.message_id
  }

  const imageMessages = await sendImageGroup(
    bot,
    chatId,
    request.images,
    messageText,
    replyToMessageId,
  )
  const firstImageMessage = imageMessages[0]

  if (!firstImageMessage) {
    throw new ConnectError("Failed to send image group", Code.Internal)
  }

  if (request.attachments.length > 0) {
    await sendAttachmentGroup(bot, chatId, request.attachments, replyToMessageId)
  }

  if (!replyMarkup) {
    return firstImageMessage.message_id
  }

  const actionMessage = await bot.api.sendMessage(
    chatId,
    strings.server.notification.chooseAction,
    {
      link_preview_options: {
        is_disabled: true,
      },
      reply_markup: replyMarkup,
      reply_parameters: toReplyParameters(replyToMessageId),
    },
  )

  return actionMessage.message_id
}

async function sendImageGroup(
  bot: Bot,
  chatId: string,
  images: Array<{ content: Uint8Array; name: string }>,
  caption?: string,
  replyToMessageId?: number,
): Promise<{ message_id: number }[]> {
  if (images.length === 1) {
    const [image] = images
    if (!image) {
      return []
    }

    const imageFile = new InputFile(Buffer.from(image.content), image.name)
    const sentMessage = await bot.api.sendPhoto(chatId, imageFile, {
      caption,
      parse_mode: caption ? "HTML" : undefined,
      show_caption_above_media: caption ? true : undefined,
      reply_parameters: toReplyParameters(replyToMessageId),
    })

    return [sentMessage]
  }

  const mediaGroup: InputMediaPhoto[] = images.map((image, index) => ({
    type: "photo",
    media: new InputFile(Buffer.from(image.content), image.name),
    caption: index === 0 ? caption : undefined,
    parse_mode: index === 0 && caption ? "HTML" : undefined,
    show_caption_above_media: index === 0 && caption ? true : undefined,
  }))

  return await bot.api.sendMediaGroup(chatId, mediaGroup, {
    reply_parameters: toReplyParameters(replyToMessageId),
  })
}

async function sendAttachmentGroup(
  bot: Bot,
  chatId: string,
  attachments: Array<{ content: Uint8Array; name: string }>,
  replyToMessageId?: number,
): Promise<void> {
  if (attachments.length === 1) {
    const [attachment] = attachments
    if (!attachment) {
      return
    }

    const attachmentFile = new InputFile(Buffer.from(attachment.content), attachment.name)
    await bot.api.sendDocument(chatId, attachmentFile, {
      reply_parameters: toReplyParameters(replyToMessageId),
    })
    return
  }

  const mediaGroup: InputMediaDocument[] = attachments.map(attachment => ({
    type: "document",
    media: new InputFile(Buffer.from(attachment.content), attachment.name),
  }))

  await bot.api.sendMediaGroup(chatId, mediaGroup, {
    reply_parameters: toReplyParameters(replyToMessageId),
  })
}

function toReplyParameters(
  replyToMessageId: number | undefined,
): { message_id: number } | undefined {
  if (replyToMessageId === undefined) {
    return undefined
  }

  return {
    message_id: replyToMessageId,
  }
}

function isReplyTargetMessageMissingError(error: unknown): boolean {
  if (error instanceof GrammyError) {
    return error.description.toLowerCase().includes("message to be replied not found")
  }

  if (error instanceof Error) {
    return error.message.toLowerCase().includes("message to be replied not found")
  }

  return String(error).toLowerCase().includes("message to be replied not found")
}

async function sendAvatarPrivacyModeWarning(args: {
  prisma: PrismaClient
  botToken: string
  targetChatId: string
  callingSubjectId: string
  sendAsSubjectId: string
}): Promise<void> {
  const warningChannel = await args.prisma.notificationChannel.findUnique({
    where: {
      name: TelegramNotificationChannels.AVATAR_PRIVACY_MODE,
    },
    select: {
      id: true,
    },
  })

  if (warningChannel === null) {
    logger.warn(
      "privacy-mode warning channel is missing, skipping avatar privacy-mode warning notification",
    )
    return
  }

  const avatar = await args.prisma.avatar.findUnique({
    where: {
      subjectId: args.sendAsSubjectId,
    },
    select: {
      managedBotUsername: true,
    },
  })

  const normalizedBotUsername = avatar?.managedBotUsername?.trim()
  const privacyModeWarningContent =
    normalizedBotUsername && normalizedBotUsername.length > 0
      ? strings.server.notification.avatarPrivacyModeWarningContent(normalizedBotUsername)
      : strings.server.notification.avatarPrivacyModeWarningContent("bot_username")

  const warningText = block(
    bold(strings.server.notification.avatarPrivacyModeWarningTitle),
    "",
    privacyModeWarningContent,
  ).html

  const warningBot = createTelegramBotClient(args.botToken, {
    role: "notification.privacy-mode-warning",
  })

  const warningMessage = await warningBot.api.sendMessage(args.targetChatId, warningText, {
    parse_mode: "HTML",
    link_preview_options: {
      is_disabled: true,
    },
  })

  await args.prisma.notification.create({
    data: {
      operationId: null,
      targetChatId: args.targetChatId,
      replyToMessageId: null,
      channelId: warningChannel.id,
      messageId: warningMessage.message_id,
      callingSubjectId: args.callingSubjectId,
      sendAsSubjectId: args.sendAsSubjectId,
      title: strings.server.notification.avatarPrivacyModeWarningTitle,
      content: privacyModeWarningContent,
      allowedActions: [],
      requiresTextResponse: false,
      isProtected: false,
    },
  })
}
