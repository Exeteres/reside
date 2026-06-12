import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type { PermissionRequestServiceClient } from "@reside/api/access/request.v1"
import type { DiscoveryServiceClient } from "@reside/api/alpha/discovery.v1"
import type { SubjectServiceClient } from "@reside/api/common/subject.v1"
import type { CommandHandlerServiceClient } from "@reside/api/interaction/command.v1"
import type { NaturalLanguageServiceClient } from "@reside/api/interaction/nls.v1"
import type { GenericOperationService, MessageElement } from "@reside/common"
import type { ResideCrypto } from "@reside/common/encryption"
import type { Client } from "@temporalio/client"
import type { Operation, PrismaClient } from "../../database"
import { CommandHandlerService } from "@reside/api/interaction/command.v1"
import { NaturalLanguageService } from "@reside/api/interaction/nls.v1"
import { block, bold, createChannel, createClient, italic, logger, rhid } from "@reside/common"
import { type Bot, type BotError, type Context, GrammyError, HttpError } from "grammy"
import { encryptedStringSchema } from "../../definitions"
import { strings } from "../../locale"
import { createInteractionContextToken } from "../../shared"
import {
  canInteractWithNotificationChannel,
  canManageNotificationChannel,
  requestNotificationChannelInteractPermission,
} from "./authorization"
import { createTelegramBotClient } from "./bot-client"
import { parseCommandInvocation, parseLeadingMention } from "./bot-command"
import { handleCommandInvocation } from "./bot-command-invocation"
import { handleManagedBotLifecycleUpdate } from "./bot-managed"
import { handleNlsMessage } from "./bot-nls"
import { ensureTargetChatExists } from "./notification-access"
import {
  bindNotificationChannel,
  deleteNotificationChannelBinding,
} from "./notification-channel-binding"
import { renderRepliedNotificationInfo, resolveRepliedNotificationInfo } from "./notification-info"
import {
  buildNotificationInlineKeyboard,
  isNotificationPaginationActionName,
  parseNotificationPaginationActionPage,
} from "./notification-pagination"
import {
  type CallbackCompletionResult,
  completeOperationFromCallbackAction,
  completeOperationFromTextReply,
  completeOperationFromTopicMessage,
} from "./response"

export {
  parseCommandInvocation,
  parseCommandParameters,
  parseStoredCommandParameters,
} from "./bot-command"

/**
 * Creates and initializes the primary Telegram bot instance used by the webhook runtime.
 *
 * The returned bot handles incoming updates, commands, callbacks, and managed-bot lifecycle events.
 *
 * @param args.token The Telegram bot token.
 * @param args.prisma The Telegram replica Prisma client.
 * @returns The initialized bot instance.
 */
export async function createTelegramBot(args: {
  token: string
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
  discoveryService: DiscoveryServiceClient
  authzService: AuthzServiceClient
  permissionRequestService: PermissionRequestServiceClient
  subjectService: SubjectServiceClient
  temporalClient: Client
  superAdminUserId: string | undefined
  crypto: ResideCrypto
}): Promise<Bot<Context>> {
  const bot = createTelegramBotClient(args.token, {
    role: "manager",
  })
  const commandHandlerClients = new Map<string, CommandHandlerServiceClient>()
  const naturalLanguageClients = new Map<string, NaturalLanguageServiceClient>()

  const getCommandHandlerClient = (callbackEndpoint: string): CommandHandlerServiceClient => {
    const existingClient = commandHandlerClients.get(callbackEndpoint)
    if (existingClient) {
      return existingClient
    }

    const createdClient = createClient(CommandHandlerService, createChannel(callbackEndpoint))
    commandHandlerClients.set(callbackEndpoint, createdClient)

    return createdClient
  }

  const getNaturalLanguageClient = (endpoint: string): NaturalLanguageServiceClient => {
    const existingClient = naturalLanguageClients.get(endpoint)
    if (existingClient) {
      return existingClient
    }

    const createdClient = createClient(NaturalLanguageService, createChannel(endpoint))
    naturalLanguageClients.set(endpoint, createdClient)

    return createdClient
  }

  bot.catch((error: BotError<Context>) => {
    if (error.error instanceof GrammyError) {
      logger.error(
        {
          method: error.error.method,
          description: error.error.description,
        },
        "telegram request failed",
      )
      return
    }

    if (error.error instanceof HttpError) {
      logger.error(
        {
          error: error.error.message,
        },
        "telegram network request failed",
      )
      return
    }

    logger.error(
      {
        error: error.error instanceof Error ? error.error.message : String(error.error),
      },
      "telegram bot update handling failed",
    )
  })

  bot.command("debug", async context => {
    await context.reply(`\`\`\`${JSON.stringify(context.update, null, 2)}\`\`\``, {
      parse_mode: "MarkdownV2",
      link_preview_options: {
        is_disabled: true,
      },
    })
  })

  bot.command("echo", async context => {
    await context.reply(context.message!.text!, {
      parse_mode: "MarkdownV2",
      link_preview_options: {
        is_disabled: true,
      },
    })
  })

  bot.command("info", async context => {
    const chatId = context.chat?.id
    const messageId = context.message?.message_id
    const repliedMessageId = context.message?.reply_to_message?.message_id
    if (!chatId || !messageId) {
      return
    }

    if (repliedMessageId === undefined) {
      await sendSystemMessage(context, {
        text: strings.worker.bot.notificationInfo.usage,
        replyToMessageId: messageId,
      })
      return
    }

    const info = await resolveRepliedNotificationInfo(
      args.prisma,
      args.subjectService,
      chatId,
      repliedMessageId,
    )

    await sendSystemMessage(context, {
      text:
        info === null
          ? strings.worker.bot.notificationInfo.notFound
          : renderRepliedNotificationInfo(info),
      replyToMessageId: messageId,
    })
  })

  bot.command("bind_notification_channel", async context => {
    const chatId = context.chat?.id
    const userId = context.from?.id
    const messageId = context.message?.message_id
    const commandText = context.message?.text
    if (!chatId || !userId || !messageId || !commandText) {
      return
    }

    const parsed = parseBindingCommandText(commandText, "bind_notification_channel")
    if (!parsed) {
      await sendSystemMessage(context, {
        text: strings.worker.bot.notificationChannelBinding.bindUsage,
        replyToMessageId: messageId,
      })
      return
    }

    const authorized = await canManageNotificationChannelFromTelegramUser(
      args,
      userId,
      parsed.channel,
    )
    if (!authorized) {
      await sendSystemMessage(context, {
        text: strings.common.accessDenied,
        replyToMessageId: messageId,
      })
      return
    }

    try {
      const chat = await ensureTargetChatExists(args.crypto, args.prisma, String(chatId))
      const topic = resolveBindingTopicInfo(context.message!, String(chatId))
      const result = await bindNotificationChannel(args.crypto, args.prisma, {
        channelName: parsed.channel,
        chatId: chat.id,
        topic,
      })

      await sendSystemMessage(context, {
        text:
          result.topicTitle === undefined
            ? strings.worker.bot.notificationChannelBinding.bound(result.channelTitle)
            : strings.worker.bot.notificationChannelBinding.boundToTopic(
                result.channelTitle,
                result.topicTitle,
              ),
        replyToMessageId: messageId,
      })
    } catch (error) {
      logger.warn(
        {
          error: error instanceof Error ? error : new Error(String(error)),
        },
        'failed to bind notification channel channel_name="%s"',
        parsed.channel,
      )

      await sendSystemMessage(context, {
        text: strings.worker.bot.notificationChannelBinding.failed,
        replyToMessageId: messageId,
      })
    }
  })

  bot.command("unbind_notification_channel", async context => {
    const userId = context.from?.id
    const messageId = context.message?.message_id
    const commandText = context.message?.text
    if (!userId || !messageId || !commandText) {
      return
    }

    const parsed = parseBindingCommandText(commandText, "unbind_notification_channel")
    if (!parsed) {
      await sendSystemMessage(context, {
        text: strings.worker.bot.notificationChannelBinding.unbindUsage,
        replyToMessageId: messageId,
      })
      return
    }

    const authorized = await canManageNotificationChannelFromTelegramUser(
      args,
      userId,
      parsed.channel,
    )
    if (!authorized) {
      await sendSystemMessage(context, {
        text: strings.common.accessDenied,
        replyToMessageId: messageId,
      })
      return
    }

    try {
      const result = await deleteNotificationChannelBinding(args.prisma, parsed.channel)
      await sendSystemMessage(context, {
        text: result.deleted
          ? strings.worker.bot.notificationChannelBinding.unbound(result.channelTitle)
          : strings.worker.bot.notificationChannelBinding.noBinding(result.channelTitle),
        replyToMessageId: messageId,
      })
    } catch (error) {
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
          channelName: parsed.channel,
        },
        "failed to unbind notification channel",
      )

      await sendSystemMessage(context, {
        text: strings.worker.bot.notificationChannelBinding.failed,
        replyToMessageId: messageId,
      })
    }
  })

  bot.use(async (context, next) => {
    try {
      await handleManagedBotLifecycleUpdate(args, context, bot)
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        "failed to handle managed bot lifecycle update",
      )
    }

    await next()
  })

  bot.on("message:text", async (context: Context) => {
    const message = context.message
    if (!message?.text) {
      return
    }

    const chatId = context.chat?.id
    const userId = context.from?.id
    if (!chatId || !userId) {
      return
    }

    logger.debug("received text message event chatId=%s userId=%s", chatId, userId)

    await ensureTelegramEntities(args.crypto, args.prisma, context)

    const interactionContext = await buildInteractionContext(args.crypto, context, {
      messageId: message.message_id,
    })

    const commandInvocation = parseCommandInvocation(message.text)
    if (commandInvocation) {
      try {
        await handleCommandInvocation({
          prisma: args.prisma,
          authzService: args.authzService,
          permissionRequestService: args.permissionRequestService,
          getCommandHandlerClient,
          chatId,
          userId,
          messageId: message.message_id,
          text: message.text,
          interactionContext,
          sendSystemMessage: async input => {
            await sendSystemMessage(context, input)
          },
        })
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            commandName: commandInvocation.name,
            chatId,
            userId,
          },
          "failed to start command workflow",
        )

        await sendSystemMessage(context, {
          text: strings.worker.bot.commandExecutionFailed,
          replyToMessageId: message.message_id,
        })
      }

      return
    }

    const mentionInvocation = parseLeadingMention(message.text)
    if (mentionInvocation) {
      const prompt = mentionInvocation.prompt.trim()
      if (prompt.length === 0) {
        return
      }

      try {
        await handleNlsMessage({
          prisma: args.prisma,
          discoveryService: args.discoveryService,
          authzService: args.authzService,
          permissionRequestService: args.permissionRequestService,
          crypto: args.crypto,
          getNaturalLanguageClient,
          managerToken: args.token,
          chatId,
          userId,
          message,
          text: prompt,
          mentionedUsername: mentionInvocation.username,
        })
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            chatId,
            userId,
          },
          "failed to handle nls mention",
        )

        await sendSystemMessage(context, {
          text: strings.worker.bot.unexpectedError,
          replyToMessageId: message.message_id,
        })
      }

      return
    }

    const textResponse = message.text.trim()
    if (textResponse.length === 0) {
      return
    }

    const topicResult = await completeTopicMessageResponse({
      crypto: args.crypto,
      prisma: args.prisma,
      operationService: args.operationService,
      permissionRequestService: args.permissionRequestService,
      authzService: args.authzService,
      superAdminUserId: args.superAdminUserId,
      chatId,
      userId,
      messageThreadId: message.message_thread_id,
      responseMessageId: message.message_id,
      textResponse,
      sendSystemMessage: async input => {
        await sendSystemMessage(context, input)
      },
    })

    if (topicResult.handled) {
      return
    }

    const repliedMessageId = message.reply_to_message?.message_id
    if (!repliedMessageId) {
      return
    }

    let result: {
      completed: boolean
      unauthorized: boolean
      unauthorizedChannelName?: string | null
    }
    try {
      result = await completeOperationFromTextReply({
        crypto: args.crypto,
        prisma: args.prisma,
        operationService: args.operationService,
        chatId,
        userId,
        repliedMessageId,
        responseMessageId: message.message_id,
        textResponse,
        isSuperAdminUser: candidateUserId =>
          args.superAdminUserId !== undefined && String(candidateUserId) === args.superAdminUserId,
        canInteractWithChannel: async (candidateUserId, channelName) =>
          await canInteractWithNotificationChannel({
            authzService: args.authzService,
            userId: candidateUserId,
            channelName,
          }),
      })
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          chatId,
          userId,
          repliedMessageId,
        },
        "failed to complete operation from text reply",
      )

      await sendSystemMessage(context, {
        text: strings.worker.bot.unexpectedError,
        replyToMessageId: message.message_id,
      })

      return
    }

    logger.debug(
      "processed text reply completion for messageId=%s completed=%s unauthorized=%s",
      message.message_id,
      result.completed,
      result.unauthorized,
    )

    if (result.unauthorized) {
      if (result.unauthorizedChannelName) {
        await requestNotificationChannelInteractPermission({
          permissionRequestService: args.permissionRequestService,
          userId,
          channelName: result.unauthorizedChannelName,
        })
      }

      await sendSystemMessage(context, {
        text: strings.common.accessDenied,
        replyToMessageId: message.message_id,
      })

      return
    }

    if (!result.completed) {
      try {
        await handleNlsMessage({
          prisma: args.prisma,
          discoveryService: args.discoveryService,
          authzService: args.authzService,
          permissionRequestService: args.permissionRequestService,
          crypto: args.crypto,
          getNaturalLanguageClient,
          managerToken: args.token,
          chatId,
          userId,
          message,
          text: textResponse,
          mentionedUsername: undefined,
        })
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            chatId,
            userId,
          },
          "failed to handle nls continuation",
        )
      }

      return
    }

    await clearInlineActions(context, chatId, repliedMessageId)
  })

  bot.on("callback_query:data", async (context: Context) => {
    const callbackQuery = context.callbackQuery
    const callbackMessage = callbackQuery?.message
    const chatId = callbackMessage?.chat.id
    const userId = callbackQuery?.from.id
    const messageId = callbackMessage?.message_id
    const actionName = callbackQuery?.data

    if (!chatId || !userId || !messageId || !actionName) {
      await context.answerCallbackQuery()
      return
    }

    logger.debug(
      "received callback action chatId=%s userId=%s messageId=%s action=%s",
      chatId,
      userId,
      messageId,
      actionName,
    )

    if (isNotificationPaginationActionName(actionName)) {
      await handleNotificationPaginationAction(context, args.prisma, chatId, messageId, actionName)
      return
    }

    const selectedOptionName = resolveCallbackOptionTitle(context, actionName)

    await ensureTelegramEntities(args.crypto, args.prisma, context)

    let result: CallbackCompletionResult
    try {
      result = await completeOperationFromCallbackAction({
        crypto: args.crypto,
        prisma: args.prisma,
        operationService: args.operationService,
        chatId,
        userId,
        messageId,
        actionName,
        isSuperAdminUser: candidateUserId =>
          args.superAdminUserId !== undefined && String(candidateUserId) === args.superAdminUserId,
        canInteractWithChannel: async (candidateUserId, channelName) =>
          await canInteractWithNotificationChannel({
            authzService: args.authzService,
            userId: candidateUserId,
            channelName,
          }),
      })
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          chatId,
          userId,
          messageId,
          actionName,
        },
        "failed to complete operation from callback action",
      )

      await context.answerCallbackQuery({
        text: strings.worker.bot.unexpectedError,
        show_alert: false,
      })

      return
    }

    logger.info(
      {
        chatId,
        userId,
        messageId,
        actionName,
        accepted: result.accepted,
        unauthorized: result.unauthorized,
        reason: result.reason,
      },
      "callback action completion result",
    )

    const applyAcceptedMessageUi = async (): Promise<void> => {
      await clearInlineActions(context, chatId, messageId)
      await appendAcceptedStamp(context, args.prisma, selectedOptionName)
    }

    if (result.accepted) {
      logger.info("callback action accepted for messageId=%s", messageId)
      await applyAcceptedMessageUi()
      return
    }

    logger.debug(
      "callback action not accepted for messageId=%s unauthorized=%s reason=%s",
      messageId,
      result.unauthorized,
      result.reason,
    )

    if (result.reason === "already-responded") {
      logger.info("reconciling callback message UI for already-responded messageId=%s", messageId)
      await applyAcceptedMessageUi()
      await context.answerCallbackQuery()
      return
    }

    if (result.reason === "action-not-allowed") {
      await context.answerCallbackQuery()
      return
    }

    if (result.unauthorized && result.unauthorizedChannelName) {
      await requestNotificationChannelInteractPermission({
        permissionRequestService: args.permissionRequestService,
        userId,
        channelName: result.unauthorizedChannelName,
      })
    }

    await context.answerCallbackQuery({
      text: result.unauthorized ? strings.common.accessDenied : strings.worker.bot.unexpectedError,
      show_alert: false,
    })
  })

  await bot.init()

  return bot
}
async function ensureTelegramEntities(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  context: Context,
): Promise<void> {
  const chat = context.chat
  const user = context.from

  const chatId = chat?.id ? String(chat.id) : null
  const userId = user?.id ? String(user.id) : null

  const chatEntity =
    chatId === null
      ? null
      : await upsertTelegramChat(crypto, prisma, chatId, chat as unknown as PrismaJson.ChatData)

  const userEntity =
    userId === null
      ? null
      : await upsertTelegramUser(crypto, prisma, userId, user as unknown as PrismaJson.UserData)

  void chatEntity
  void userEntity

  return
}

async function upsertTelegramChat(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  telegramChatId: string,
  data: PrismaJson.ChatData,
): Promise<{ id: number }> {
  const telegramRhid = rhid(telegramChatId)
  const dataEcid = await crypto.encrypt(data)

  return await prisma.chat.upsert({
    where: {
      telegramRhid,
    },
    create: {
      telegramRhid,
      dataEcid,
    },
    update: {
      dataEcid,
    },
    select: {
      id: true,
    },
  })
}

async function upsertTelegramUser(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  telegramUserId: string,
  data: PrismaJson.UserData,
): Promise<{ id: number }> {
  const telegramRhid = rhid(telegramUserId)
  const username = toOptionalNonEmptyString(data.username)
  const firstName = toOptionalNonEmptyString(data.first_name)
  const lastName = toOptionalNonEmptyString(data.last_name)

  const existingUser = await prisma.user.findUnique({
    where: {
      telegramRhid,
    },
    select: {
      id: true,
      telegramUserIdEcid: true,
      usernameEcid: true,
      firstNameEcid: true,
      lastNameEcid: true,
    },
  })

  if (!existingUser) {
    return await prisma.user.create({
      data: {
        telegramRhid,
        telegramUserIdEcid: await crypto.encrypt(telegramUserId),
        usernameEcid: username === undefined ? null : await crypto.encrypt(username),
        firstNameEcid: firstName === undefined ? null : await crypto.encrypt(firstName),
        lastNameEcid: lastName === undefined ? null : await crypto.encrypt(lastName),
      },
      select: {
        id: true,
      },
    })
  }

  const updateData: {
    telegramUserIdEcid?: string
    usernameEcid?: string | null
    firstNameEcid?: string | null
    lastNameEcid?: string | null
  } = {}

  const currentTelegramUserId = await crypto.decrypt(
    encryptedStringSchema,
    existingUser.telegramUserIdEcid,
  )
  if (currentTelegramUserId !== telegramUserId) {
    updateData.telegramUserIdEcid = await crypto.encrypt(telegramUserId)
  }

  const currentUsername = await decryptOptionalString(crypto, existingUser.usernameEcid)
  if (currentUsername !== username) {
    updateData.usernameEcid = username === undefined ? null : await crypto.encrypt(username)
  }

  const currentFirstName = await decryptOptionalString(crypto, existingUser.firstNameEcid)
  if (currentFirstName !== firstName) {
    updateData.firstNameEcid = firstName === undefined ? null : await crypto.encrypt(firstName)
  }

  const currentLastName = await decryptOptionalString(crypto, existingUser.lastNameEcid)
  if (currentLastName !== lastName) {
    updateData.lastNameEcid = lastName === undefined ? null : await crypto.encrypt(lastName)
  }

  if (Object.keys(updateData).length === 0) {
    return {
      id: existingUser.id,
    }
  }

  return await prisma.user.update({
    where: {
      telegramRhid,
    },
    data: updateData,
    select: {
      id: true,
    },
  })
}

async function decryptOptionalString(
  crypto: ResideCrypto,
  ecid: string | null,
): Promise<string | undefined> {
  if (ecid === null) {
    return undefined
  }

  return await crypto.decrypt(encryptedStringSchema, ecid)
}

function toOptionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const normalized = value.trim()
  if (normalized.length === 0) {
    return undefined
  }

  return normalized
}

async function canManageNotificationChannelFromTelegramUser(
  args: {
    authzService: AuthzServiceClient
    superAdminUserId: string | undefined
  },
  userId: number,
  channelName: string,
): Promise<boolean> {
  if (args.superAdminUserId !== undefined && String(userId) === args.superAdminUserId) {
    return true
  }

  return await canManageNotificationChannel({
    authzService: args.authzService,
    userId,
    channelName,
  })
}

export function parseBindingCommandText(
  text: string,
  commandName: string,
): { channel: string } | null {
  const [rawCommand, ...rawArgs] = text.trim().split(/\s+/)
  const normalizedCommand = rawCommand?.split("@")[0]
  if (normalizedCommand !== `/${commandName}`) {
    return null
  }

  const channel = rawArgs[0]?.trim()
  if (!channel) {
    return null
  }

  if (rawArgs.length > 1) {
    return null
  }

  return {
    channel,
  }
}

export function resolveBindingMessageThreadId(message: {
  is_topic_message?: boolean
  message_thread_id?: number
}): number | undefined {
  return resolveBindingTopicInfo(message, "")?.messageThreadId
}

export function resolveBindingTopicInfo(
  message: {
    is_topic_message?: boolean
    message_thread_id?: number
    forum_topic_created?: {
      name?: string
    }
    reply_to_message?: {
      forum_topic_created?: {
        name?: string
      }
    }
  },
  chatId: string,
): { chatId: string; messageThreadId: number; title?: string } | undefined {
  if (message.is_topic_message !== true) {
    return undefined
  }

  const messageThreadId = message.message_thread_id
  if (typeof messageThreadId !== "number" || !Number.isInteger(messageThreadId)) {
    return undefined
  }

  const title =
    message.forum_topic_created?.name ?? message.reply_to_message?.forum_topic_created?.name

  return {
    chatId,
    messageThreadId,
    title,
  }
}

async function buildInteractionContext(
  crypto: ResideCrypto,
  context: Context,
  options?: {
    messageId?: number
  },
): Promise<{ token: string; title: string }> {
  const chat = context.chat
  const user = context.from

  if (!chat) {
    throw new Error("Interaction context requires chat information")
  }

  const interactionContextToken = await createInteractionContextToken(crypto, {
    chat_id: String(chat.id),
    message_id: options?.messageId,
  })

  const type: "SYSTEM" | "CHAT" | "USER_PRIVATE" | "USER_IN_CHAT" =
    chat.type === "private" ? "USER_PRIVATE" : user?.id ? "USER_IN_CHAT" : "CHAT"

  const title =
    type === "USER_PRIVATE"
      ? formatUserTitle(user)
      : type === "USER_IN_CHAT"
        ? `${formatChatTitle(chat)} / ${formatUserTitle(user)}`
        : formatChatTitle(chat)

  return {
    token: interactionContextToken,
    title,
  }
}

async function appendAcceptedStamp(
  context: Context,
  prisma: PrismaClient,
  selectedOptionName?: string,
): Promise<void> {
  const callbackMessage = context.callbackQuery?.message
  const chatId = callbackMessage?.chat.id
  const messageId = callbackMessage?.message_id

  if (!chatId || !messageId) {
    return
  }

  const notification = await prisma.notification.findFirst({
    where: {
      messageRhid: rhid(messageId),
      chat: {
        telegramRhid: rhid(String(chatId)),
      },
    },
    select: {
      title: true,
      content: true,
      expectImmediateFeedback: true,
    },
    orderBy: {
      id: "desc",
    },
  })

  if (!notification) {
    logger.warn({ chatId, messageId }, "notification not found for accepted stamp rendering")
    return
  }

  if (notification.expectImmediateFeedback) {
    return
  }

  const subjectTitle = formatUserTitle(context.from)
  const { date, time } = formatMskDateTime(new Date())
  const renderedNotification = renderStoredNotificationMessage(notification)
  const suffixText =
    selectedOptionName === undefined
      ? strings.worker.bot.acceptedSuffix(subjectTitle, date, time)
      : strings.worker.bot.acceptedActionSuffix(subjectTitle, selectedOptionName, date, time)
  const suffix = bold(italic(suffixText))
  const updatedMessage = block(renderedNotification, "", suffix).html
  const preservedUrlOnlyMarkup = resolveUrlOnlyReplyMarkup(context, messageId)

  try {
    await context.api.editMessageText(chatId, messageId, updatedMessage, {
      parse_mode: "HTML",
      link_preview_options: {
        is_disabled: true,
      },
      reply_markup: preservedUrlOnlyMarkup,
    })
  } catch (error) {
    logger.warn(
      {
        chatId,
        messageId,
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to append accepted stamp to message",
    )
  }
}

async function handleNotificationPaginationAction(
  context: Context,
  prisma: PrismaClient,
  chatId: number,
  messageId: number,
  actionName: string,
): Promise<void> {
  const page = parseNotificationPaginationActionPage(actionName)
  if (page === undefined) {
    await context.answerCallbackQuery()
    return
  }

  const notification = await prisma.notification.findFirst({
    where: {
      messageRhid: rhid(messageId),
      chat: {
        telegramRhid: rhid(String(chatId)),
      },
    },
    select: {
      actionRows: true,
    },
    orderBy: {
      id: "desc",
    },
  })

  if (!notification) {
    await context.answerCallbackQuery()
    return
  }

  const replyMarkup = buildNotificationInlineKeyboard(notification.actionRows, page)

  try {
    await context.api.editMessageReplyMarkup(chatId, messageId, {
      reply_markup: replyMarkup,
    })
  } catch (error) {
    logger.warn(
      {
        chatId,
        messageId,
        page,
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to paginate notification actions",
    )
  }

  await context.answerCallbackQuery()
}

function resolveCallbackOptionTitle(context: Context, actionName: string): string {
  const keyboard = context.callbackQuery?.message?.reply_markup?.inline_keyboard

  if (!Array.isArray(keyboard)) {
    return actionName
  }

  for (const row of keyboard) {
    if (!Array.isArray(row)) {
      continue
    }

    for (const button of row) {
      if (
        button &&
        "callback_data" in button &&
        button.callback_data === actionName &&
        typeof button.text === "string"
      ) {
        return button.text
      }
    }
  }

  return actionName
}

function formatMskDateTime(date: Date): { date: string; time: string } {
  const mskDate = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date)

  const mskTime = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)

  return {
    date: mskDate,
    time: mskTime,
  }
}

function renderStoredNotificationMessage(input: {
  title: string
  content: string
}): MessageElement {
  const content = input.content.trim()
  if (content.length > 0) {
    return block(bold(input.title), "", { html: content })
  }

  return block(bold(input.title))
}

async function sendSystemMessage(
  context: Context,
  args: {
    text: string
    replyToMessageId?: number
  },
): Promise<number | undefined> {
  const message = args.text

  const sentMessage = await context.reply(message, {
    parse_mode: "HTML",
    link_preview_options: {
      is_disabled: true,
    },
    reply_parameters:
      args.replyToMessageId === undefined
        ? undefined
        : {
            message_id: args.replyToMessageId,
          },
  })

  return sentMessage.message_id
}

function formatUserTitle(user: Context["from"]): string {
  if (!user) {
    return strings.common.user
  }

  if (user.username) {
    return user.username
  }

  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim()
  if (fullName.length > 0) {
    return fullName
  }

  return strings.worker.bot.userById(user.id)
}

function formatChatTitle(chat: Context["chat"]): string {
  if (!chat) {
    return strings.worker.bot.systemTitle
  }

  if (chat.type === "private") {
    return strings.worker.bot.privateChatTitle
  }

  if ("title" in chat && typeof chat.title === "string" && chat.title.length > 0) {
    return chat.title
  }

  return strings.worker.bot.chatById(chat.id)
}

async function clearInlineActions(
  context: Context,
  chatId: number,
  messageId: number,
): Promise<void> {
  const preservedUrlOnlyMarkup = resolveUrlOnlyReplyMarkup(context, messageId)

  try {
    await context.api.editMessageReplyMarkup(chatId, messageId, {
      reply_markup: preservedUrlOnlyMarkup,
    })
  } catch (error) {
    logger.warn(
      {
        chatId,
        messageId,
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to clear notification actions",
    )
  }
}

async function completeTopicMessageResponse(args: {
  crypto: ResideCrypto
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
  permissionRequestService: PermissionRequestServiceClient
  authzService: AuthzServiceClient
  superAdminUserId: string | undefined
  chatId: number
  userId: number
  messageThreadId: number | undefined
  responseMessageId: number
  textResponse: string
  sendSystemMessage: (input: { text: string; replyToMessageId: number }) => Promise<void>
}): Promise<{ handled: boolean }> {
  let result: {
    completed: boolean
    unauthorized: boolean
    unauthorizedChannelName?: string | null
  }

  try {
    result = await completeOperationFromTopicMessage({
      crypto: args.crypto,
      prisma: args.prisma,
      operationService: args.operationService,
      chatId: args.chatId,
      userId: args.userId,
      messageThreadId: args.messageThreadId,
      responseMessageId: args.responseMessageId,
      textResponse: args.textResponse,
      isSuperAdminUser: candidateUserId =>
        args.superAdminUserId !== undefined && String(candidateUserId) === args.superAdminUserId,
      canInteractWithChannel: async (candidateUserId, channelName) =>
        await canInteractWithNotificationChannel({
          authzService: args.authzService,
          userId: candidateUserId,
          channelName,
        }),
    })
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error : new Error(String(error)),
      },
      "failed to complete operation from topic message",
    )

    await args.sendSystemMessage({
      text: strings.worker.bot.unexpectedError,
      replyToMessageId: args.responseMessageId,
    })

    return { handled: true }
  }

  if (result.unauthorized) {
    if (result.unauthorizedChannelName) {
      await requestNotificationChannelInteractPermission({
        permissionRequestService: args.permissionRequestService,
        userId: args.userId,
        channelName: result.unauthorizedChannelName,
      })
    }

    await args.sendSystemMessage({
      text: strings.common.accessDenied,
      replyToMessageId: args.responseMessageId,
    })

    return { handled: true }
  }

  return { handled: result.completed }
}

function resolveUrlOnlyReplyMarkup(context: Context, messageId: number) {
  const keyboard = resolveInlineKeyboardForMessage(context, messageId)
  const inlineKeyboard: Array<Array<{ text: string; url: string }>> = []

  if (!Array.isArray(keyboard)) {
    return {
      inline_keyboard: inlineKeyboard,
    }
  }

  for (const row of keyboard) {
    if (!Array.isArray(row)) {
      continue
    }

    const urlButtons: Array<{ text: string; url: string }> = []

    for (const button of row) {
      if (!button || typeof button !== "object") {
        continue
      }

      if (!("text" in button) || !("url" in button)) {
        continue
      }

      if (typeof button.text !== "string" || typeof button.url !== "string") {
        continue
      }

      urlButtons.push({
        text: button.text,
        url: button.url,
      })
    }

    if (urlButtons.length > 0) {
      inlineKeyboard.push(urlButtons)
    }
  }

  return {
    inline_keyboard: inlineKeyboard,
  }
}

function resolveInlineKeyboardForMessage(context: Context, messageId: number): unknown {
  const callbackMessage = context.callbackQuery?.message
  if (callbackMessage?.message_id === messageId) {
    return callbackMessage.reply_markup?.inline_keyboard
  }

  const repliedMessage = context.message?.reply_to_message
  if (repliedMessage?.message_id === messageId) {
    return repliedMessage.reply_markup?.inline_keyboard
  }

  if (context.message?.message_id === messageId) {
    return context.message.reply_markup?.inline_keyboard
  }

  return undefined
}
