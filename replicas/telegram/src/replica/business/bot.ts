import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type { PermissionRequestServiceClient } from "@reside/api/access/request.v1"
import type { DiscoveryServiceClient } from "@reside/api/alpha/discovery.v1"
import type { SubjectServiceClient } from "@reside/api/common/subject.v1"
import type { CommandHandlerServiceClient } from "@reside/api/interaction/command.v1"
import type { NaturalLanguageServiceClient } from "@reside/api/interaction/nls.v1"
import type { GenericOperationService, MessageElement } from "@reside/common"
import type { ResideCrypto } from "@reside/common/encryption"
import type { Client } from "@temporalio/client"
import type { Chat, User } from "grammy/types"
import type { Operation, PrismaClient } from "../../database"
import type { NotificationStatus, NotificationTaskStatus } from "./notification-types"
import { CommandHandlerService } from "@reside/api/interaction/command.v1"
import { NaturalLanguageService } from "@reside/api/interaction/nls.v1"
import {
  block,
  bold,
  createChannel,
  createClient,
  html,
  italic,
  logger,
  rhid,
} from "@reside/common"
import { type Bot, type BotError, type Context, GrammyError, HttpError } from "grammy"
import { getTelegramMessageChatId, telegramSentMessageSchema } from "../../definitions"
import { strings } from "../../locale"
import { createInteractionContextToken } from "../../shared"
import {
  canInteractWithNotificationChannel,
  canManageNotificationChannel,
  requestNotificationChannelInteractPermission,
} from "./authorization"
import { createTelegramBotClient } from "./bot-client"
import { parseCommandInvocation, parseLeadingMention } from "./bot-command"
import { handleCommandInvocation, type TelegramMessageEntity } from "./bot-command-invocation"
import { handleManagedBotLifecycleUpdate } from "./bot-managed"
import { handleNlsMessage } from "./bot-nls"
import { ensureTargetChatExists } from "./notification-access"
import {
  bindNotificationChannel,
  deleteNotificationChannelBinding,
} from "./notification-channel-binding"
import { renderRepliedNotificationInfo, resolveRepliedNotificationInfo } from "./notification-info"
import {
  EDIT_NOTIFICATION_TASKS_ACTION,
  getStatusIcon,
  renderNotificationTaskRows,
} from "./notification-message"
import {
  buildNotificationInlineKeyboard,
  isNotificationPaginationActionName,
  parseNotificationPaginationActionPage,
} from "./notification-pagination"
import {
  type CallbackCompletionResult,
  completeOperationFromCallbackAction,
  completeOperationFromDiceMessage,
  completeOperationFromTextReply,
  completeOperationFromTopicMessage,
} from "./response"
import { resolveTelegramSubjectIdByTelegramUserId, toTelegramSubjectId } from "./subject"
import { replaceUserReferencesWithSubjectIds } from "./user-reference"

export {
  parseCommandInvocation,
  parseCommandParameters,
  parseStoredCommandParameters,
} from "./bot-command"

type InteractionContextType = "SYSTEM" | "CHAT" | "USER_PRIVATE" | "USER_IN_CHAT"
type ClearContextTargetKind = "replica" | "mention"

type ClearContextTarget = {
  kind: ClearContextTargetKind
  value: string
}

type StoredNotificationTaskGroup = {
  title: string
  tasks: StoredNotificationTask[]
}

type StoredNotificationTask = {
  title: string
  status: NotificationTaskStatus
}

type PlanningPromptRecord = {
  id: number
  messageEcid: string
  launchedByUserId: number
  notification: {
    id: number
    isProtected: boolean
    channel: {
      name: string
    }
    operationId: number | null
    operation: {
      status: string
      notificationResponse: {
        operationId: number
      } | null
    } | null
  }
  options: PlanningPromptOptionRecord[]
}

type PlanningPromptOptionRecord = {
  optionId: number
  taskNotificationId: number
  taskGroupStableId: string
  taskStableId: string
}

type UrlInlineKeyboardButton = { text: string; url: string }
type UrlInlineKeyboardRow = UrlInlineKeyboardButton[]

const MIN_TELEGRAM_TASK_POLL_OPTIONS = 2
const MAX_TELEGRAM_TASK_POLL_OPTIONS = 12

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

  bot.command("ping", async context => {
    await sendSystemMessage(context, {
      text: strings.worker.bot.pong,
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

  bot.command("clear_context", async context => {
    const userId = context.from?.id
    const messageId = context.message?.message_id
    const commandText = context.message?.text
    if (!userId || !messageId || !commandText) {
      return
    }

    const parsed = parseClearContextCommandText(commandText)
    if (!parsed) {
      await sendSystemMessage(context, {
        text: strings.worker.bot.nlsClearContextUsage,
        replyToMessageId: messageId,
      })
      return
    }

    try {
      const replicaName = await resolveClearContextTargetReplicaName(args.prisma, parsed.target)
      if (!replicaName) {
        await sendSystemMessage(context, {
          text: strings.worker.bot.nlsClearContextReplicaNotFound(parsed.target.value),
          replyToMessageId: messageId,
        })
        return
      }

      const subjectId = await resolveTelegramSubjectIdByTelegramUserId(args.prisma, userId)
      if (subjectId === undefined) {
        await sendSystemMessage(context, {
          text: strings.common.accessDenied,
          replyToMessageId: messageId,
        })
        return
      }

      const endpoint = await args.discoveryService.getSubjectEndpoint({
        subjectId: `replica:${replicaName}`,
      })

      await getNaturalLanguageClient(endpoint.endpoint).clearSubjectContext({
        subjectId,
      })

      await sendSystemMessage(context, {
        text: strings.worker.bot.nlsClearContextSucceeded(replicaName),
        replyToMessageId: messageId,
      })
    } catch (error) {
      logger.warn(
        {
          error: error instanceof Error ? error : new Error(String(error)),
        },
        'failed to clear nls context user_id="%s" target="%s"',
        userId,
        parsed.target.value,
      )

      await sendSystemMessage(context, {
        text: strings.worker.bot.nlsClearContextFailed,
        replyToMessageId: messageId,
      })
    }
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

  bot.on("poll_answer", async context => {
    await handleNotificationTaskPollAnswer(args, context)
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

  bot.use(async (context, next) => {
    if (context.message !== undefined && context.from !== undefined) {
      const entities = await ensureTelegramEntities(args.crypto, args.prisma, context)
      if (entities.user !== null) {
        await incrementUserMessageCounter(args.prisma, entities.user.id)
      }
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

    logger.debug(
      'received text message event has_reply="%s" has_thread="%s" entities_count="%s"',
      String(message.reply_to_message !== undefined),
      String(message.message_thread_id !== undefined),
      String(message.entities?.length ?? 0),
    )

    const entities = await ensureTelegramEntities(args.crypto, args.prisma, context)
    const subjectUserId = entities.user?.id
    const subjectId = subjectUserId === undefined ? undefined : toTelegramSubjectId(subjectUserId)

    const textResponse = message.text.trim()
    const repliedMessageId = message.reply_to_message?.message_id
    if (textResponse.length > 0 && repliedMessageId !== undefined) {
      const taskSelectionResult = await handleNotificationTaskTextSelection(
        args,
        context,
        userId,
        repliedMessageId,
        message.message_id,
        textResponse,
      )
      if (taskSelectionResult.handled) {
        if (taskSelectionResult.completed) {
          await setUserMessageAcceptedReaction(bot, chatId, message.message_id)
        }

        return
      }
    }

    const interactionContext = await buildInteractionContext(args.crypto, context, {
      messageId: message.message_id,
    })
    const textWithSubjectIds = await replaceUserReferencesWithSubjectIds({
      crypto: args.crypto,
      prisma: args.prisma,
      text: message.text,
    })

    const commandInvocation = parseCommandInvocation(message.text)
    if (commandInvocation) {
      if (subjectUserId === undefined) {
        return
      }

      try {
        await handleCommandInvocation({
          prisma: args.prisma,
          crypto: args.crypto,
          authzService: args.authzService,
          permissionRequestService: args.permissionRequestService,
          getCommandHandlerClient,
          chatId,
          userId,
          subjectUserId,
          messageId: message.message_id,
          text: textWithSubjectIds,
          entities: message.entities as TelegramMessageEntity[] | undefined,
          interactionContext,
          sendSystemMessage: async input => {
            await sendSystemMessage(context, input)
          },
        })
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error : new Error(String(error)),
            commandName: commandInvocation.name,
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
      if (subjectUserId === undefined) {
        return
      }

      const prompt = await replaceUserReferencesWithSubjectIds({
        crypto: args.crypto,
        prisma: args.prisma,
        text: mentionInvocation.prompt.trim(),
      })
      if (prompt.length === 0) {
        return
      }

      try {
        await handleNlsMessage({
          prisma: args.prisma,
          subjectService: args.subjectService,
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
          sourceText: message.text,
          entities: message.entities as TelegramMessageEntity[] | undefined,
          mentionedUsername: mentionInvocation.username,
        })
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error : new Error(String(error)),
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
      subjectUserId,
      messageThreadId: message.message_thread_id,
      responseMessageId: message.message_id,
      textResponse,
      sendSystemMessage: async input => {
        await sendSystemMessage(context, input)
      },
    })

    if (topicResult.handled) {
      if (topicResult.completed) {
        await setUserMessageAcceptedReaction(bot, chatId, message.message_id)
      }

      return
    }

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
        subjectUserId,
        repliedMessageId,
        responseMessageId: message.message_id,
        textResponse,
        isSuperAdminUser: candidateUserId =>
          args.superAdminUserId !== undefined && String(candidateUserId) === args.superAdminUserId,
        canInteractWithChannel: async (candidateUserId, channelName) => {
          const candidateSubjectId = await resolveTelegramSubjectIdByTelegramUserId(
            args.prisma,
            candidateUserId,
          )
          if (candidateSubjectId === undefined) {
            return false
          }

          return await canInteractWithNotificationChannel({
            authzService: args.authzService,
            subjectId: candidateSubjectId,
            channelName,
          })
        },
      })
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error : new Error(String(error)),
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
      'processed text reply completion completed="%s" unauthorized="%s"',
      String(result.completed),
      String(result.unauthorized),
    )

    if (result.unauthorized) {
      if (result.unauthorizedChannelName) {
        if (subjectId === undefined) {
          return
        }

        await requestNotificationChannelInteractPermission({
          permissionRequestService: args.permissionRequestService,
          subjectId,
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
          subjectService: args.subjectService,
          discoveryService: args.discoveryService,
          authzService: args.authzService,
          permissionRequestService: args.permissionRequestService,
          crypto: args.crypto,
          getNaturalLanguageClient,
          managerToken: args.token,
          chatId,
          userId,
          message,
          text: await replaceUserReferencesWithSubjectIds({
            crypto: args.crypto,
            prisma: args.prisma,
            text: textResponse,
          }),
          sourceText: message.text,
          entities: message.entities as TelegramMessageEntity[] | undefined,
          mentionedUsername: undefined,
        })
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error : new Error(String(error)),
          },
          "failed to handle nls continuation",
        )
      }

      return
    }

    await setUserMessageAcceptedReaction(bot, chatId, message.message_id)
    await clearInlineActions(context, chatId, repliedMessageId)
  })

  bot.on("message:dice", async (context: Context) => {
    const message = context.message
    const dice = message?.dice
    const chatId = context.chat?.id
    const userId = context.from?.id
    if (!message || !dice || !chatId || !userId) {
      return
    }

    const entities = await ensureTelegramEntities(args.crypto, args.prisma, context)
    const subjectUserId = entities.user?.id
    await completeDiceMessageResponse({
      crypto: args.crypto,
      prisma: args.prisma,
      operationService: args.operationService,
      permissionRequestService: args.permissionRequestService,
      authzService: args.authzService,
      superAdminUserId: args.superAdminUserId,
      chatId,
      userId,
      subjectUserId,
      messageThreadId: message.message_thread_id,
      responseMessageId: message.message_id,
      emoji: dice.emoji,
      value: dice.value,
      sendSystemMessage: async input => {
        await sendSystemMessage(context, input)
      },
    })

    return
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

    logger.debug('received callback action action_name="%s"', actionName)

    if (actionName === EDIT_NOTIFICATION_TASKS_ACTION) {
      await handleNotificationTaskEditAction(args, context, chatId, userId, messageId)
      return
    }

    if (isNotificationPaginationActionName(actionName)) {
      await handleNotificationPaginationAction(context, args.prisma, chatId, messageId, actionName)
      return
    }

    const selectedOptionName = resolveCallbackOptionTitle(context, actionName)

    const entities = await ensureTelegramEntities(args.crypto, args.prisma, context)
    const subjectUserId = entities.user?.id

    let result: CallbackCompletionResult
    try {
      result = await completeOperationFromCallbackAction({
        crypto: args.crypto,
        prisma: args.prisma,
        operationService: args.operationService,
        chatId,
        userId,
        subjectUserId,
        messageId,
        actionName,
        isSuperAdminUser: candidateUserId =>
          args.superAdminUserId !== undefined && String(candidateUserId) === args.superAdminUserId,
        canInteractWithChannel: async (candidateUserId, channelName) => {
          const candidateSubjectId = await resolveTelegramSubjectIdByTelegramUserId(
            args.prisma,
            candidateUserId,
          )
          if (candidateSubjectId === undefined) {
            return false
          }

          return await canInteractWithNotificationChannel({
            authzService: args.authzService,
            subjectId: candidateSubjectId,
            channelName,
          })
        },
      })
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error : new Error(String(error)),
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
      'callback action completion result action_name="%s" accepted="%s" unauthorized="%s" reason="%s"',
      actionName,
      String(result.accepted),
      String(result.unauthorized),
      result.reason,
    )

    const applyAcceptedMessageUi = async (): Promise<void> => {
      await clearInlineActions(context, chatId, messageId)
      await appendAcceptedStamp(context, args.prisma, selectedOptionName)
    }

    if (result.accepted) {
      logger.info('callback action accepted action_name="%s"', actionName)
      await applyAcceptedMessageUi()
      return
    }

    logger.debug(
      'callback action not accepted action_name="%s" unauthorized="%s" reason="%s"',
      actionName,
      String(result.unauthorized),
      result.reason,
    )

    if (result.reason === "already-responded") {
      logger.info(
        'reconciling callback message ui for already-responded action_name="%s"',
        actionName,
      )
      await applyAcceptedMessageUi()
      await context.answerCallbackQuery()
      return
    }

    if (result.reason === "action-not-allowed") {
      await context.answerCallbackQuery()
      return
    }

    if (result.unauthorized && result.unauthorizedChannelName) {
      const subjectId = await resolveTelegramSubjectIdByTelegramUserId(args.prisma, userId)
      if (subjectId === undefined) {
        await context.answerCallbackQuery({
          text: strings.common.accessDenied,
          show_alert: false,
        })
        return
      }

      await requestNotificationChannelInteractPermission({
        permissionRequestService: args.permissionRequestService,
        subjectId,
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
): Promise<{ chat: { id: number } | null; user: { id: number } | null }> {
  const chat = context.chat
  const user = context.from

  const chatId = chat?.id ? String(chat.id) : null
  const userId = user?.id ? String(user.id) : null

  const chatEntity =
    chatId === null ? null : await upsertTelegramChat(crypto, prisma, chatId, chat as Chat)

  const userEntity =
    userId === null ? null : await upsertTelegramUser(crypto, prisma, userId, user as User)

  return {
    chat: chatEntity,
    user: userEntity,
  }
}

async function incrementUserMessageCounter(prisma: PrismaClient, userId: number): Promise<void> {
  await prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      totalMessages: {
        increment: 1,
      },
    },
  })
}

async function upsertTelegramChat(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  telegramChatId: string,
  data: Chat,
): Promise<{ id: number }> {
  const telegramRhid = rhid(telegramChatId)
  const dataRhid = rhid(data)

  const existingChat = await prisma.chat.findUnique({
    where: {
      telegramRhid,
    },
    select: {
      id: true,
      dataRhid: true,
    },
  })

  if (existingChat !== null && existingChat.dataRhid === dataRhid) {
    return {
      id: existingChat.id,
    }
  }

  const dataEcid = await crypto.encrypt(data)

  if (existingChat !== null) {
    return await prisma.chat.update({
      where: {
        telegramRhid,
      },
      data: {
        dataEcid,
        dataRhid,
      },
      select: {
        id: true,
      },
    })
  }

  return await prisma.chat.create({
    data: {
      telegramRhid,
      dataEcid,
      dataRhid,
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
  data: User,
): Promise<{ id: number }> {
  const telegramRhid = rhid(telegramUserId)
  const dataRhid = rhid(data)
  const username = toOptionalNonEmptyString(data.username)

  const existingUser = await prisma.user.findUnique({
    where: {
      telegramRhid,
    },
    select: {
      id: true,
      usernameRhid: true,
      dataRhid: true,
    },
  })

  if (!existingUser) {
    const dataEcid = await crypto.encrypt(data)

    return await prisma.user.create({
      data: {
        telegramRhid,
        usernameRhid: username === undefined ? null : rhid(username.toLowerCase()),
        dataEcid,
        dataRhid,
      },
      select: {
        id: true,
      },
    })
  }

  const updateData: {
    usernameRhid?: string | null
    dataEcid?: string
    dataRhid?: string
  } = {}

  const usernameRhid = username === undefined ? null : rhid(username.toLowerCase())
  if (existingUser.usernameRhid !== usernameRhid) {
    updateData.usernameRhid = usernameRhid
  }

  if (existingUser.dataRhid !== dataRhid) {
    updateData.dataEcid = await crypto.encrypt(data)
    updateData.dataRhid = dataRhid
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
    prisma: PrismaClient
    superAdminUserId: string | undefined
  },
  userId: number,
  channelName: string,
): Promise<boolean> {
  if (args.superAdminUserId !== undefined && String(userId) === args.superAdminUserId) {
    return true
  }

  const subjectId = await resolveTelegramSubjectIdByTelegramUserId(args.prisma, userId)
  if (subjectId === undefined) {
    return false
  }

  return await canManageNotificationChannel({
    authzService: args.authzService,
    subjectId,
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

export function parseClearContextCommandText(text: string): {
  target: ClearContextTarget
} | null {
  const [rawCommand, ...rawArgs] = text.trim().split(/\s+/)
  const normalizedCommand = rawCommand?.split("@")[0]
  if (normalizedCommand !== "/clear_context") {
    return null
  }

  const rawTarget = rawArgs[0]?.trim()
  if (!rawTarget || rawArgs.length > 1) {
    return null
  }

  if (rawTarget.startsWith("@")) {
    const username = rawTarget.slice(1).trim()
    if (!/^[A-Za-z0-9_]+$/.test(username)) {
      return null
    }

    return {
      target: {
        kind: "mention",
        value: username,
      },
    }
  }

  if (!/^[a-z0-9-]+$/.test(rawTarget)) {
    return null
  }

  return {
    target: {
      kind: "replica",
      value: rawTarget,
    },
  }
}

async function resolveClearContextTargetReplicaName(
  prisma: PrismaClient,
  target: ClearContextTarget,
): Promise<string | null> {
  if (target.kind === "replica") {
    return target.value
  }

  const avatar = await prisma.avatar.findFirst({
    where: {
      managedBotUsername: {
        equals: target.value,
        mode: "insensitive",
      },
    },
    select: {
      replicaName: true,
    },
  })

  return avatar?.replicaName ?? null
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

  const type: InteractionContextType =
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
      status: true,
      expectImmediateFeedback: true,
      taskGroups: {
        orderBy: {
          position: "asc",
        },
        select: {
          title: true,
          tasks: {
            orderBy: {
              position: "asc",
            },
            select: {
              title: true,
              status: true,
            },
          },
        },
      },
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

async function handleNotificationTaskEditAction(
  args: {
    crypto: ResideCrypto
    prisma: PrismaClient
    authzService: AuthzServiceClient
    permissionRequestService: PermissionRequestServiceClient
    superAdminUserId: string | undefined
  },
  context: Context,
  chatId: number,
  userId: number,
  messageId: number,
): Promise<void> {
  await ensureTelegramEntities(args.crypto, args.prisma, context)

  const user = await upsertTelegramUser(
    args.crypto,
    args.prisma,
    String(userId),
    context.from as User,
  )

  const notification = await args.prisma.notification.findFirst({
    where: {
      messageRhid: rhid(messageId),
      chat: {
        telegramRhid: rhid(String(chatId)),
      },
      status: "PLANNING",
    },
    select: {
      id: true,
      isProtected: true,
      channel: {
        select: {
          name: true,
        },
      },
      taskGroups: {
        orderBy: {
          position: "asc",
        },
        select: {
          stableId: true,
          tasks: {
            orderBy: {
              position: "asc",
            },
            select: {
              notificationId: true,
              groupStableId: true,
              stableId: true,
              title: true,
            },
          },
        },
      },
    },
    orderBy: {
      id: "desc",
    },
  })

  const tasks = notification?.taskGroups.flatMap(group => group.tasks) ?? []
  if (notification === null || tasks.length === 0) {
    await context.answerCallbackQuery()
    return
  }

  const subjectId = toTelegramSubjectId(user.id)
  const canInteract = await canInteractWithNotificationChannel({
    authzService: args.authzService,
    subjectId,
    channelName: notification.channel.name,
  })

  if (notification.isProtected && !canSuperAdminInteract(args, userId) && !canInteract) {
    await requestNotificationChannelInteractPermission({
      permissionRequestService: args.permissionRequestService,
      subjectId,
      channelName: notification.channel.name,
    })
    await context.answerCallbackQuery({
      text: strings.common.accessDenied,
      show_alert: false,
    })
    return
  }

  if (canUseTelegramTaskPlanningPoll(tasks.length)) {
    const sentPoll = await context.replyWithPoll(
      strings.server.notification.editTasksPollTitle,
      tasks.map(task => task.title),
      {
        allow_adding_options: false,
        allows_multiple_answers: true,
        allows_revoting: false,
        is_anonymous: false,
        reply_parameters: {
          message_id: messageId,
        },
      },
    )

    if (!sentPoll.poll?.id) {
      await context.answerCallbackQuery({
        text: strings.worker.bot.unexpectedError,
        show_alert: false,
      })
      return
    }

    await createNotificationTaskPlanningPrompt(
      args.crypto,
      args.prisma,
      notification.id,
      rhid(sentPoll.poll.id),
      sentPoll,
      user.id,
      tasks,
    )

    await context.answerCallbackQuery()
    return
  }

  const sentMessage = await context.reply(renderNotificationTaskSelectionFallbackMessage(tasks), {
    parse_mode: "HTML",
    link_preview_options: {
      is_disabled: true,
    },
    reply_parameters: {
      message_id: messageId,
    },
  })

  await createNotificationTaskPlanningPrompt(
    args.crypto,
    args.prisma,
    notification.id,
    getTaskSelectionFallbackRhid(sentMessage.message_id),
    sentMessage,
    user.id,
    tasks,
  )

  await context.answerCallbackQuery()
}

async function handleNotificationTaskPollAnswer(
  args: {
    crypto: ResideCrypto
    prisma: PrismaClient
    operationService: GenericOperationService<Operation>
    authzService: AuthzServiceClient
    permissionRequestService: PermissionRequestServiceClient
    superAdminUserId: string | undefined
  },
  context: Context,
): Promise<void> {
  const pollAnswer = context.pollAnswer
  if (pollAnswer === undefined) {
    return
  }

  const user = pollAnswer.user
  if (!user) {
    return
  }

  const userRecord = await upsertTelegramUser(args.crypto, args.prisma, String(user.id), user)

  const poll = await args.prisma.notificationTaskPlanningPoll.findUnique({
    where: {
      pollRhid: rhid(pollAnswer.poll_id),
    },
    select: {
      id: true,
      messageEcid: true,
      launchedByUserId: true,
      notification: {
        select: {
          id: true,
          isProtected: true,
          channel: {
            select: {
              name: true,
            },
          },
          operationId: true,
          messageEcid: true,
          operation: {
            select: {
              status: true,
              notificationResponse: {
                select: {
                  operationId: true,
                },
              },
            },
          },
        },
      },
      options: {
        select: {
          optionId: true,
          taskNotificationId: true,
          taskGroupStableId: true,
          taskStableId: true,
        },
      },
    },
  })

  if (poll === null || poll.launchedByUserId !== userRecord.id) {
    return
  }

  const subjectId = toTelegramSubjectId(userRecord.id)
  const canInteract = await canInteractWithNotificationChannel({
    authzService: args.authzService,
    subjectId,
    channelName: poll.notification.channel.name,
  })

  if (poll.notification.isProtected && !canSuperAdminInteract(args, user.id) && !canInteract) {
    await requestNotificationChannelInteractPermission({
      permissionRequestService: args.permissionRequestService,
      subjectId,
      channelName: poll.notification.channel.name,
    })
    await deletePlanningPollMessage(args.crypto, context, poll.messageEcid)
    await args.prisma.notificationTaskPlanningPoll.delete({
      where: {
        id: poll.id,
      },
    })
    return
  }

  const selectedOptionIds = new Set(pollAnswer.option_ids)
  const operationIdToComplete = await applyNotificationTaskPlanningSelection(
    args.prisma,
    poll,
    selectedOptionIds,
    subjectId,
  )

  await deletePlanningPollMessage(args.crypto, context, poll.messageEcid)
  await rerenderStoredNotification(args.crypto, args.prisma, context, poll.notification.id)

  if (operationIdToComplete !== undefined) {
    await args.operationService.setCompleted(operationIdToComplete)
  }
}

async function handleNotificationTaskTextSelection(
  args: {
    crypto: ResideCrypto
    prisma: PrismaClient
    operationService: GenericOperationService<Operation>
    authzService: AuthzServiceClient
    permissionRequestService: PermissionRequestServiceClient
    superAdminUserId: string | undefined
  },
  context: Context,
  userId: number,
  repliedMessageId: number,
  responseMessageId: number,
  textResponse: string,
): Promise<{ completed: boolean; handled: boolean }> {
  const prompt = await findNotificationTaskPlanningPrompt(
    args.prisma,
    getTaskSelectionFallbackRhid(repliedMessageId),
  )
  if (prompt === null) {
    return { completed: false, handled: false }
  }

  const userRecord = await upsertTelegramUser(
    args.crypto,
    args.prisma,
    String(userId),
    context.from as User,
  )

  if (prompt.launchedByUserId !== userRecord.id) {
    await sendSystemMessage(context, {
      text: strings.common.accessDenied,
      replyToMessageId: responseMessageId,
    })
    return { completed: false, handled: true }
  }

  const selectedOptionIds = parseNotificationTaskSelectionText(textResponse, prompt.options.length)
  if (selectedOptionIds === null) {
    await sendSystemMessage(context, {
      text: strings.worker.bot.notificationTaskSelectionInvalid,
      replyToMessageId: responseMessageId,
    })
    return { completed: false, handled: true }
  }

  const subjectId = toTelegramSubjectId(userRecord.id)
  const canInteract = await canInteractWithNotificationChannel({
    authzService: args.authzService,
    subjectId,
    channelName: prompt.notification.channel.name,
  })

  if (prompt.notification.isProtected && !canSuperAdminInteract(args, userId) && !canInteract) {
    await requestNotificationChannelInteractPermission({
      permissionRequestService: args.permissionRequestService,
      subjectId,
      channelName: prompt.notification.channel.name,
    })
    await deletePlanningPollMessage(args.crypto, context, prompt.messageEcid)
    await args.prisma.notificationTaskPlanningPoll.delete({
      where: {
        id: prompt.id,
      },
    })
    await sendSystemMessage(context, {
      text: strings.common.accessDenied,
      replyToMessageId: responseMessageId,
    })
    return { completed: false, handled: true }
  }

  const operationIdToComplete = await applyNotificationTaskPlanningSelection(
    args.prisma,
    prompt,
    selectedOptionIds,
    subjectId,
  )

  await deletePlanningPollMessage(args.crypto, context, prompt.messageEcid)
  await rerenderStoredNotification(args.crypto, args.prisma, context, prompt.notification.id)

  if (operationIdToComplete !== undefined) {
    await args.operationService.setCompleted(operationIdToComplete)
  }

  return { completed: true, handled: true }
}

async function createNotificationTaskPlanningPrompt(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  notificationId: number,
  promptRhid: string,
  sentMessage: unknown,
  launchedByUserId: number,
  tasks: {
    notificationId: number
    groupStableId: string
    stableId: string
  }[],
): Promise<void> {
  await prisma.notificationTaskPlanningPoll.create({
    data: {
      notificationId,
      pollRhid: promptRhid,
      messageEcid: await crypto.encrypt(sentMessage),
      launchedByUserId,
      options: {
        create: tasks.map((task, optionId) => ({
          optionId,
          task: {
            connect: {
              notificationId_groupStableId_stableId: {
                notificationId: task.notificationId,
                groupStableId: task.groupStableId,
                stableId: task.stableId,
              },
            },
          },
        })),
      },
    },
  })
}

async function findNotificationTaskPlanningPrompt(
  prisma: PrismaClient,
  promptRhid: string,
): Promise<PlanningPromptRecord | null> {
  return await prisma.notificationTaskPlanningPoll.findUnique({
    where: {
      pollRhid: promptRhid,
    },
    select: {
      id: true,
      messageEcid: true,
      launchedByUserId: true,
      notification: {
        select: {
          id: true,
          isProtected: true,
          channel: {
            select: {
              name: true,
            },
          },
          operationId: true,
          operation: {
            select: {
              status: true,
              notificationResponse: {
                select: {
                  operationId: true,
                },
              },
            },
          },
        },
      },
      options: {
        orderBy: {
          optionId: "asc",
        },
        select: {
          optionId: true,
          taskNotificationId: true,
          taskGroupStableId: true,
          taskStableId: true,
        },
      },
    },
  })
}

async function applyNotificationTaskPlanningSelection(
  prisma: PrismaClient,
  prompt: PlanningPromptRecord,
  selectedOptionIds: Set<number>,
  subjectId: string | undefined,
): Promise<number | undefined> {
  const operationIdToComplete =
    prompt.notification.operationId !== null &&
    prompt.notification.operation?.status === "PENDING" &&
    prompt.notification.operation.notificationResponse === null
      ? prompt.notification.operationId
      : undefined

  await prisma.$transaction(async tx => {
    for (const option of prompt.options) {
      await tx.notificationTask.update({
        where: {
          notificationId_groupStableId_stableId: {
            notificationId: option.taskNotificationId,
            groupStableId: option.taskGroupStableId,
            stableId: option.taskStableId,
          },
        },
        data: {
          status: selectedOptionIds.has(option.optionId) ? "PLANNED" : "SKIPPED",
        },
      })
    }

    if (operationIdToComplete !== undefined) {
      await tx.notificationResponse.create({
        data: {
          operationId: operationIdToComplete,
          type: "TASK_UPDATE",
          actionName: null,
          subjectId: subjectId ?? null,
          textResponseEcid: null,
        },
      })
    }

    await tx.notificationTaskPlanningPoll.delete({
      where: {
        id: prompt.id,
      },
    })
  })

  return operationIdToComplete
}

function getTaskSelectionFallbackRhid(messageId: number): string {
  return rhid(`task-selection-fallback:${messageId}`)
}

export function canUseTelegramTaskPlanningPoll(taskCount: number): boolean {
  return taskCount >= MIN_TELEGRAM_TASK_POLL_OPTIONS && taskCount <= MAX_TELEGRAM_TASK_POLL_OPTIONS
}

export function parseNotificationTaskSelectionText(
  text: string,
  taskCount: number,
): Set<number> | null {
  const tokens = text
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
  if (tokens.length === 0 || taskCount < 1) {
    return null
  }

  const selectedOptionIds = new Set<number>()
  for (const token of tokens) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(token)
    if (!match) {
      return null
    }

    const start = Number(match[1])
    const end = match[2] === undefined ? start : Number(match[2])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      return null
    }

    if (start < 1 || end < 1 || start > taskCount || end > taskCount || start > end) {
      return null
    }

    for (let value = start; value <= end; value++) {
      selectedOptionIds.add(value - 1)
    }
  }

  return selectedOptionIds
}

function canSuperAdminInteract(
  args: { superAdminUserId: string | undefined },
  userId: number,
): boolean {
  return args.superAdminUserId !== undefined && String(userId) === args.superAdminUserId
}

async function deletePlanningPollMessage(
  crypto: ResideCrypto,
  context: Context,
  messageEcid: string,
): Promise<void> {
  const pollMessage = await crypto.decrypt(telegramSentMessageSchema, messageEcid)

  try {
    await context.api.deleteMessage(getTelegramMessageChatId(pollMessage), pollMessage.message_id)
  } catch (error) {
    logger.warn(
      {
        error: error instanceof Error ? error : new Error(String(error)),
      },
      "failed to delete notification task planning poll",
    )
  }
}

async function rerenderStoredNotification(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  context: Context,
  notificationId: number,
): Promise<void> {
  const notification = await prisma.notification.findUnique({
    where: {
      id: notificationId,
    },
    select: {
      title: true,
      content: true,
      status: true,
      actionRows: true,
      messageEcid: true,
      taskGroups: {
        orderBy: {
          position: "asc",
        },
        select: {
          title: true,
          tasks: {
            orderBy: {
              position: "asc",
            },
            select: {
              title: true,
              status: true,
            },
          },
        },
      },
    },
  })

  if (notification === null) {
    return
  }

  const telegramMessage = await crypto.decrypt(telegramSentMessageSchema, notification.messageEcid)
  const chatId = getTelegramMessageChatId(telegramMessage)
  const messageId = telegramMessage.message_id
  const renderedNotification = renderStoredNotificationMessage(notification).html
  const replyMarkup = buildNotificationInlineKeyboard(notification.actionRows, 0, {
    status: notification.status,
  })

  try {
    await context.api.editMessageText(chatId, messageId, renderedNotification, {
      parse_mode: "HTML",
      link_preview_options: {
        is_disabled: true,
      },
      reply_markup: replyMarkup,
    })
  } catch (error) {
    logger.warn(
      {
        error: error instanceof Error ? error : new Error(String(error)),
      },
      "failed to rerender notification after task planning poll",
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
      status: true,
    },
    orderBy: {
      id: "desc",
    },
  })

  if (!notification) {
    await context.answerCallbackQuery()
    return
  }

  const replyMarkup = buildNotificationInlineKeyboard(notification.actionRows, page, {
    status: notification.status,
  })

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

export function renderStoredNotificationMessage(input: {
  title: string
  content: string
  status: NotificationStatus
  taskGroups: StoredNotificationTaskGroup[]
}): MessageElement {
  const content = input.content.trim()
  const title = `${getStatusIcon(input.status)} ${input.title}`.trim()
  const taskRows = renderNotificationTaskRows(input.taskGroups)
  if (content.length > 0) {
    return block(bold(title), "", { html: content }, ...taskRows)
  }

  return block(bold(title), ...taskRows)
}

function renderNotificationTaskSelectionFallbackMessage(tasks: { title: string }[]): string {
  const taskRows = tasks.map((task, index) => ({
    html: `${index + 1}. ${html(task.title)}`,
  }))

  return block(
    bold(strings.server.notification.editTasksTextTitle),
    strings.server.notification.editTasksTextInstruction,
    "",
    ...taskRows,
  ).html
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
  subjectUserId: number | undefined
  messageThreadId: number | undefined
  responseMessageId: number
  textResponse: string
  sendSystemMessage: (input: { text: string; replyToMessageId: number }) => Promise<void>
}): Promise<{ completed: boolean; handled: boolean }> {
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
      subjectUserId: args.subjectUserId,
      messageThreadId: args.messageThreadId,
      responseMessageId: args.responseMessageId,
      textResponse: args.textResponse,
      isSuperAdminUser: candidateUserId =>
        args.superAdminUserId !== undefined && String(candidateUserId) === args.superAdminUserId,
      canInteractWithChannel: async (candidateUserId, channelName) => {
        const candidateSubjectId = await resolveTelegramSubjectIdByTelegramUserId(
          args.prisma,
          candidateUserId,
        )
        if (candidateSubjectId === undefined) {
          return false
        }

        return await canInteractWithNotificationChannel({
          authzService: args.authzService,
          subjectId: candidateSubjectId,
          channelName,
        })
      },
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

    return { completed: false, handled: true }
  }

  if (result.unauthorized) {
    if (result.unauthorizedChannelName) {
      const subjectId = await resolveTelegramSubjectIdByTelegramUserId(args.prisma, args.userId)
      if (subjectId === undefined) {
        return { completed: false, handled: true }
      }

      await requestNotificationChannelInteractPermission({
        permissionRequestService: args.permissionRequestService,
        subjectId,
        channelName: result.unauthorizedChannelName,
      })
    }

    await args.sendSystemMessage({
      text: strings.common.accessDenied,
      replyToMessageId: args.responseMessageId,
    })

    return { completed: false, handled: true }
  }

  return { completed: result.completed, handled: result.completed }
}

async function completeDiceMessageResponse(args: {
  crypto: ResideCrypto
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
  permissionRequestService: PermissionRequestServiceClient
  authzService: AuthzServiceClient
  superAdminUserId: string | undefined
  chatId: number
  userId: number
  subjectUserId: number | undefined
  messageThreadId: number | undefined
  responseMessageId: number
  emoji: string
  value: number
  sendSystemMessage: (input: { text: string; replyToMessageId: number }) => Promise<void>
}): Promise<{ completed: boolean; handled: boolean }> {
  let result: {
    completed: boolean
    unauthorized: boolean
    unauthorizedChannelName?: string | null
  }

  try {
    result = await completeOperationFromDiceMessage({
      crypto: args.crypto,
      prisma: args.prisma,
      operationService: args.operationService,
      chatId: args.chatId,
      userId: args.userId,
      subjectUserId: args.subjectUserId,
      messageThreadId: args.messageThreadId,
      responseMessageId: args.responseMessageId,
      emoji: args.emoji,
      value: args.value,
      isSuperAdminUser: candidateUserId =>
        args.superAdminUserId !== undefined && String(candidateUserId) === args.superAdminUserId,
      canInteractWithChannel: async (candidateUserId, channelName) => {
        const candidateSubjectId = await resolveTelegramSubjectIdByTelegramUserId(
          args.prisma,
          candidateUserId,
        )
        if (candidateSubjectId === undefined) {
          return false
        }

        return await canInteractWithNotificationChannel({
          authzService: args.authzService,
          subjectId: candidateSubjectId,
          channelName,
        })
      },
    })
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error : new Error(String(error)),
      },
      "failed to complete operation from dice message",
    )

    await args.sendSystemMessage({
      text: strings.worker.bot.unexpectedError,
      replyToMessageId: args.responseMessageId,
    })

    return { completed: false, handled: true }
  }

  if (result.unauthorized) {
    if (result.unauthorizedChannelName) {
      const subjectId = await resolveTelegramSubjectIdByTelegramUserId(args.prisma, args.userId)
      if (subjectId === undefined) {
        return { completed: false, handled: true }
      }

      await requestNotificationChannelInteractPermission({
        permissionRequestService: args.permissionRequestService,
        subjectId,
        channelName: result.unauthorizedChannelName,
      })
    }

    await args.sendSystemMessage({
      text: strings.common.accessDenied,
      replyToMessageId: args.responseMessageId,
    })

    return { completed: false, handled: true }
  }

  return { completed: result.completed, handled: result.completed }
}

async function setUserMessageAcceptedReaction(
  bot: Bot<Context>,
  chatId: number,
  messageId: number,
): Promise<void> {
  try {
    await bot.api.setMessageReaction(chatId, messageId, [
      {
        type: "emoji",
        emoji: "👀",
      },
    ])
  } catch (error) {
    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to set accepted reaction on user message",
    )
  }
}

function resolveUrlOnlyReplyMarkup(context: Context, messageId: number) {
  const keyboard = resolveInlineKeyboardForMessage(context, messageId)
  const inlineKeyboard: UrlInlineKeyboardRow[] = []

  if (!Array.isArray(keyboard)) {
    return {
      inline_keyboard: inlineKeyboard,
    }
  }

  for (const row of keyboard) {
    if (!Array.isArray(row)) {
      continue
    }

    const urlButtons: UrlInlineKeyboardButton[] = []

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
