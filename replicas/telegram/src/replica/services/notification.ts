import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type { Operation } from "@reside/api/common/operation.v1"
import type { SubjectServiceClient } from "@reside/api/common/subject.v1"
import type {
  NotificationServiceImplementation,
  SendNotificationRequest,
  SendNotificationResponse,
  UpdateNotificationRequest,
  UpdateNotificationResponse,
} from "@reside/api/interaction/notification.v1"
import type { InlineKeyboardMarkup, InputMediaDocument, InputMediaPhoto } from "grammy/types"
import type { PrismaClient } from "../../database"
import { status } from "@grpc/grpc-js"
import { CoreV1Api } from "@kubernetes/client-node"
import {
  authenticateReplica,
  block,
  bold,
  code,
  customEmoji,
  getReplicaNamespace,
  inline,
  kubeConfig,
  logger,
  SPACE,
  WellKnownPermissions,
} from "@reside/common"
import { Bot, InputFile } from "grammy"
import { type CallContext, ServerError } from "nice-grpc"
import { strings } from "../../locale"
import { loadTelegramSecretState, TELEGRAM_SECRET_NAME } from "../secret"

const TELEGRAM_CONFIG_MAP_NAME = "telegram"
const TELEGRAM_SYSTEM_CHAT_ID_KEY = "system_chat_id"
const RESPONSE_OPERATION_TITLE = strings.server.notification.responseOperationTitle
const HEADER_EMOJI_FIRST_ID = "5199547568144554620"
const HEADER_EMOJI_SECOND_ID = "5201851568990749302"
const HEADER_EMOJI_THIRD_ID = "5202075663204387704"
const HEADER_EMOJI_FOURTH_ID = "5199493481621395003"

export function createNotificationService(
  prisma: PrismaClient,
  operationService: {
    toApiOperation: (operationId: number) => Promise<Operation>
  },
  accessAuthzService: AuthzServiceClient,
  accessSubjectService: SubjectServiceClient,
): NotificationServiceImplementation {
  const namespace = getReplicaNamespace()
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)

  return {
    async sendNotification(
      request: SendNotificationRequest,
      context: CallContext,
    ): Promise<SendNotificationResponse> {
      const { name: replicaName } = await authenticateReplica(context)
      logger.info(
        "sendNotification requested by replica %s for channel %s",
        replicaName,
        request.channel,
      )
      const contextId = parseContextId(request.contextId)
      assertChannelName(request.channel)
      const replicaSubjectId = `replica:${replicaName}`
      const senderSubjectId = await resolveSenderSubjectId({
        accessAuthzService,
        callerSubjectId: replicaSubjectId,
        requestedSubjectId: request.sendAsSubjectId,
      })
      const senderDisplayTitle = await resolveSenderDisplayTitle(
        accessSubjectService,
        senderSubjectId,
        senderSubjectId,
      )

      const channel = await prisma.notificationChannel.findUnique({
        where: {
          name: request.channel,
        },
      })

      if (!channel) {
        throw new ServerError(
          status.NOT_FOUND,
          `Channel with name "${request.channel}" was not found`,
        )
      }

      assertActionNames(request.actions)

      const interactionContext = await prisma.interactionContext.findUnique({
        where: {
          id: contextId,
        },
        select: {
          id: true,
          type: true,
          lastUserMessageId: true,
          chat: {
            select: {
              telegramId: true,
            },
          },
          user: {
            select: {
              telegramId: true,
            },
          },
        },
      })

      if (!interactionContext) {
        throw new ServerError(
          status.NOT_FOUND,
          `Interaction context "${request.contextId}" was not found`,
        )
      }

      const hasPendingResponse = request.actions.length > 0 || request.requiresTextResponse === true
      const messageText = toTelegramMessageText(request, senderDisplayTitle, senderSubjectId)
      logger.debug(
        "prepared telegram notification payload for channel %s (pendingResponse=%s)",
        request.channel,
        hasPendingResponse,
      )

      try {
        const deliveryConfig = await loadDeliveryConfig(coreApi, namespace)
        const bot = new Bot(deliveryConfig.botToken)
        const replyMarkup = toInlineKeyboardMarkup(request)
        const targetChatId = resolveTargetChatId(interactionContext, deliveryConfig.systemChatId)
        const replyToMessageId = resolveReplyToMessageId(interactionContext)

        const sentMessageId = await sendNotificationPayload(
          bot,
          targetChatId,
          request,
          messageText,
          replyMarkup,
          replyToMessageId,
        )

        if (!hasPendingResponse) {
          const notification = await prisma.notification.create({
            data: {
              operationId: null,
              contextId: interactionContext.id,
              channelId: channel.id,
              messageId: sentMessageId,
              callingSubjectId: replicaSubjectId,
              sendAsSubjectId: senderSubjectId,
              title: request.title,
              content: request.content ?? "",
              allowedActions: request.actions.map(action => action.name),
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
              contextId: interactionContext.id,
              channelId: channel.id,
              messageId: sentMessageId,
              callingSubjectId: replicaSubjectId,
              sendAsSubjectId: senderSubjectId,
              title: request.title,
              content: request.content ?? "",
              allowedActions: request.actions.map(action => action.name),
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

        throw new ServerError(status.INTERNAL, "Failed to send telegram notification")
      }
    },

    async updateNotification(
      request: UpdateNotificationRequest,
      context: CallContext,
    ): Promise<UpdateNotificationResponse> {
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
        accessSubjectService,
        senderSubjectId,
        replicaName,
      )

      if (request.title.length === 0) {
        throw new ServerError(status.INVALID_ARGUMENT, "Notification title must not be empty")
      }

      const notification = await prisma.notification.findFirst({
        where: {
          id: notificationId,
        },
        select: {
          id: true,
          messageId: true,
          allowedActions: true,
          requiresTextResponse: true,
          operationId: true,
          operation: {
            select: {
              status: true,
            },
          },
          context: {
            select: {
              type: true,
              chat: {
                select: {
                  telegramId: true,
                },
              },
              user: {
                select: {
                  telegramId: true,
                },
              },
            },
          },
        },
      })

      if (notification === null) {
        throw new ServerError(
          status.NOT_FOUND,
          `Notification "${request.notificationId}" was not found`,
        )
      }

      const nextAllowedActions = request.actions.map(action => action.name)
      const nextRequiresTextResponse =
        request.requiresTextResponse ?? notification.requiresTextResponse
      const nextHasPendingResponse =
        nextAllowedActions.length > 0 || nextRequiresTextResponse === true

      const shouldReplaceWaitOperation =
        notification.operationId !== null && notification.operation?.status === "PENDING"

      try {
        const deliveryConfig = await loadDeliveryConfig(coreApi, namespace)
        const bot = new Bot(deliveryConfig.botToken)
        const replyMarkup = toInlineKeyboardMarkupFromActions(request.actions)
        const targetChatId = resolveTargetChatId(
          {
            ...notification.context,
            lastUserMessageId: null,
          },
          deliveryConfig.systemChatId,
        )

        const messageText = toTelegramMessageTextValue(
          {
            title: request.title,
            content: request.content,
          },
          senderDisplayTitle,
          senderSubjectId,
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

        throw new ServerError(status.INTERNAL, "Failed to update telegram notification")
      }
    },
  }
}

async function resolveSenderSubjectId(args: {
  accessAuthzService: AuthzServiceClient
  callerSubjectId: string
  requestedSubjectId: string | undefined
}): Promise<string> {
  if (args.requestedSubjectId === undefined) {
    return args.callerSubjectId
  }

  const requestedSubjectId = args.requestedSubjectId.trim()
  if (requestedSubjectId.length === 0) {
    throw new ServerError(status.INVALID_ARGUMENT, "sendAsSubjectId must not be empty")
  }

  if (requestedSubjectId === args.callerSubjectId) {
    return requestedSubjectId
  }

  const permissionCheck = await args.accessAuthzService.checkPermission({
    permissionName: WellKnownPermissions.TELEGRAM_NOTIFICATION_SEND_AS_SUBJECT,
    subjectId: args.callerSubjectId,
    scope: requestedSubjectId,
  })

  if (!permissionCheck.authorized) {
    throw new ServerError(
      status.PERMISSION_DENIED,
      `Subject "${args.callerSubjectId}" is not allowed to send notifications as subject "${requestedSubjectId}"`,
    )
  }

  return requestedSubjectId
}

function assertActionNames(actions: Array<{ name: string }>): void {
  for (const action of actions) {
    if (action.name.length === 0) {
      throw new ServerError(status.INVALID_ARGUMENT, "Action name must not be empty")
    }
  }
}

function parseContextId(contextId: string): number {
  if (contextId.length === 0) {
    throw new ServerError(status.INVALID_ARGUMENT, "Context id is required")
  }

  const parsedContextId = Number(contextId)
  if (!Number.isInteger(parsedContextId) || parsedContextId <= 0) {
    throw new ServerError(status.INVALID_ARGUMENT, `Invalid context id "${contextId}"`)
  }

  return parsedContextId
}

function parseNotificationId(notificationId: string): number {
  if (notificationId.length === 0) {
    throw new ServerError(status.INVALID_ARGUMENT, "Notification id is required")
  }

  const parsedNotificationId = Number(notificationId)
  if (!Number.isInteger(parsedNotificationId) || parsedNotificationId <= 0) {
    throw new ServerError(status.INVALID_ARGUMENT, `Invalid notification id "${notificationId}"`)
  }

  return parsedNotificationId
}

function assertChannelName(channelName: string): void {
  if (channelName.length > 0) {
    return
  }

  throw new ServerError(status.INVALID_ARGUMENT, "Channel name must not be empty")
}

async function loadDeliveryConfig(
  coreApi: CoreV1Api,
  namespace: string,
): Promise<{ botToken: string; systemChatId: string }> {
  const secretState = await loadTelegramSecretState(coreApi, namespace)

  if (!secretState.botToken) {
    throw new ServerError(
      status.FAILED_PRECONDITION,
      `Secret "${TELEGRAM_SECRET_NAME}" must contain "bot_token"`,
    )
  }

  const configMap = await coreApi.readNamespacedConfigMap({
    name: TELEGRAM_CONFIG_MAP_NAME,
    namespace,
  })

  const systemChatId = configMap.data?.[TELEGRAM_SYSTEM_CHAT_ID_KEY]?.trim()
  if (!systemChatId) {
    throw new ServerError(
      status.FAILED_PRECONDITION,
      `ConfigMap "${TELEGRAM_CONFIG_MAP_NAME}" must contain "${TELEGRAM_SYSTEM_CHAT_ID_KEY}"`,
    )
  }

  return {
    botToken: secretState.botToken,
    systemChatId,
  }
}

function toTelegramMessageText(
  request: SendNotificationRequest,
  senderTitle: string,
  senderSubjectId: string,
): string {
  return toTelegramMessageTextValue(
    {
      title: request.title,
      content: request.content,
    },
    senderTitle,
    senderSubjectId,
  )
}

function toTelegramMessageTextValue(
  input: {
    title: string
    content: string | undefined
  },
  senderTitle: string,
  senderSubjectId: string,
): string {
  const header = renderNotificationHeader(senderTitle, senderSubjectId)
  const content = input.content?.trim()
  if (content) {
    return block(header, "", bold(input.title), { html: content }).html
  }

  return block(header, "", bold(input.title)).html
}

function renderNotificationHeader(senderTitle: string, senderSubjectId: string) {
  return block(
    inline(
      customEmoji(HEADER_EMOJI_FIRST_ID),
      customEmoji(HEADER_EMOJI_SECOND_ID),
      SPACE,
      bold(senderTitle),
    ),
    inline(
      customEmoji(HEADER_EMOJI_THIRD_ID),
      customEmoji(HEADER_EMOJI_FOURTH_ID),
      SPACE,
      code(senderSubjectId),
    ),
  )
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

function toInlineKeyboardMarkup(
  request: SendNotificationRequest,
): InlineKeyboardMarkup | undefined {
  return toInlineKeyboardMarkupFromActions(request.actions)
}

function toInlineKeyboardMarkupFromActions(
  actions: Array<{ name: string; title: string }>,
): InlineKeyboardMarkup | undefined {
  if (actions.length === 0) {
    return undefined
  }

  return {
    inline_keyboard: actions.map(action => [
      {
        text: action.title,
        callback_data: action.name,
      },
    ]),
  }
}

async function sendNotificationPayload(
  bot: Bot,
  chatId: string,
  request: SendNotificationRequest,
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
    throw new ServerError(status.INTERNAL, "Failed to send image group")
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
  images: SendNotificationRequest["images"],
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
  attachments: SendNotificationRequest["attachments"],
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

function resolveTargetChatId(
  context: {
    type: "SYSTEM" | "CHAT" | "USER_PRIVATE" | "USER_IN_CHAT"
    lastUserMessageId: number | null
    chat: { telegramId: string } | null
    user: { telegramId: string } | null
  },
  systemChatId: string,
): string {
  if (context.chat?.telegramId) {
    return context.chat.telegramId
  }

  if (context.user?.telegramId) {
    return context.user.telegramId
  }

  if (context.type === "SYSTEM") {
    return systemChatId
  }

  throw new ServerError(status.FAILED_PRECONDITION, "Context does not contain chat or user target")
}

function resolveReplyToMessageId(context: {
  type: "SYSTEM" | "CHAT" | "USER_PRIVATE" | "USER_IN_CHAT"
  lastUserMessageId: number | null
}): number | undefined {
  if (context.type !== "USER_IN_CHAT") {
    return undefined
  }

  if (context.lastUserMessageId === null) {
    throw new ServerError(
      status.FAILED_PRECONDITION,
      "User-in-chat context does not have last observed user message id",
    )
  }

  return context.lastUserMessageId
}
