import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type { PermissionRequestServiceClient } from "@reside/api/access/request.v1"
import type { CommandHandlerServiceClient } from "@reside/api/interaction/command.v1"
import type { CommandParameter } from "@reside/api/interaction/definition.v1"
import type { GenericOperationService, MessageElement } from "@reside/common"
import type { Operation, PrismaClient } from "../database"
import { createChannel } from "@reside/api"
import { CommandHandlerServiceDefinition } from "@reside/api/interaction/command.v1"
import { CommandParameterType } from "@reside/api/interaction/definition.v1"
import {
  block,
  bold,
  code,
  createClient,
  customEmoji,
  getReplicaName,
  inline,
  italic,
  logger,
  SPACE,
} from "@reside/common"
import { Bot, type BotError, type Context, GrammyError, HttpError } from "grammy"
import { strings } from "../locale"
import {
  canInteractWithNotificationChannel,
  canInvokeCommand,
  requestCommandInvokePermission,
} from "./authorization"
import {
  type CallbackCompletionResult,
  completeOperationFromCallbackAction,
  completeOperationFromTextReply,
} from "./response"

const SYSTEM_MESSAGE_HEADER_EMOJI_FIRST_ID = "5199547568144554620"
const SYSTEM_MESSAGE_HEADER_EMOJI_SECOND_ID = "5201851568990749302"
const SYSTEM_MESSAGE_HEADER_EMOJI_THIRD_ID = "5202075663204387704"
const SYSTEM_MESSAGE_HEADER_EMOJI_FOURTH_ID = "5199493481621395003"

function getSystemReplicaName(): string {
  return getReplicaName()
}

function getSystemReplicaSubjectId(): string {
  return `replica:${getSystemReplicaName()}`
}

/**
 * Creates a Telegram bot instance with the demo commands used in local testing.
 *
 * @param args.token The Telegram bot token.
 * @param args.prisma The Telegram replica Prisma client.
 * @returns The initialized bot instance.
 */
export async function createTelegramBot(args: {
  token: string
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
  authzService: AuthzServiceClient
  permissionRequestService: PermissionRequestServiceClient
  superAdminUserId: string | undefined
}): Promise<Bot<Context>> {
  const bot = new Bot(args.token)
  const commandHandlerClients = new Map<string, CommandHandlerServiceClient>()

  function getCommandHandlerClient(callbackEndpoint: string): CommandHandlerServiceClient {
    const existing = commandHandlerClients.get(callbackEndpoint)
    if (existing) {
      return existing
    }

    const channel = createChannel(callbackEndpoint)
    const client = createClient(CommandHandlerServiceDefinition, channel)

    commandHandlerClients.set(callbackEndpoint, client)
    return client
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

    const interactionContext = await ensureInteractionContext(args.prisma, context, {
      lastUserMessageId: message.message_id,
    })

    const commandInvocation = parseCommandInvocation(message.text)
    if (commandInvocation) {
      logger.info("detected command invocation /%s", commandInvocation.name)

      const commandDefinition = await args.prisma.command.findUnique({
        where: {
          name: commandInvocation.name,
        },
      })

      if (!commandDefinition) {
        logger.warn("command definition not found for /%s", commandInvocation.name)

        await sendSystemMessage(context, {
          text: strings.worker.bot.commandNotFound(commandInvocation.name),
          replyToMessageId: message.message_id,
        })
        return
      }

      if (commandDefinition.isProtected) {
        const commandPermission = await canInvokeCommand({
          authzService: args.authzService,
          userId,
          commandName: commandDefinition.name,
        })

        if (!commandPermission.authorized) {
          if (commandPermission.checked) {
            logger.info(
              "requesting invoke permission for protected command /%s and user %s",
              commandDefinition.name,
              userId,
            )

            await requestCommandInvokePermission({
              permissionRequestService: args.permissionRequestService,
              userId,
              commandName: commandDefinition.name,
            })
          }

          await sendSystemMessage(context, {
            text: strings.common.accessDenied,
            replyToMessageId: message.message_id,
          })
          return
        }
      }

      let parameters: Record<string, unknown>
      try {
        parameters = parseCommandParameters(
          commandDefinition.parameters,
          commandInvocation.parameters,
        )
      } catch (error) {
        await sendSystemMessage(context, {
          text: error instanceof Error ? error.message : String(error),
          replyToMessageId: message.message_id,
        })
        return
      }

      try {
        logger.info(
          "invoking command handler for /%s at %s",
          commandDefinition.name,
          commandDefinition.callbackEndpoint,
        )

        await getCommandHandlerClient(commandDefinition.callbackEndpoint).invokeCommand({
          invocationId: `${message.chat.id}:${message.message_id}`,
          command: {
            id: commandDefinition.id,
            name: commandDefinition.name,
            title: commandDefinition.title,
            description: commandDefinition.description ?? undefined,
            parameters: parseStoredCommandParameters(commandDefinition.parameters),
            protected: commandDefinition.isProtected,
            callbackEndpoint: commandDefinition.callbackEndpoint,
          },
          context: {
            id: interactionContext.id,
            title: interactionContext.title,
          },
          parameters,
          subjectId: `telegram:${userId}`,
        })

        logger.info("command handler invocation finished for /%s", commandDefinition.name)
      } catch (error) {
        logger.error(
          {
            command: commandDefinition.name,
            callbackEndpoint: commandDefinition.callbackEndpoint,
            error: error instanceof Error ? error.message : String(error),
          },
          "failed to invoke command handler",
        )

        await sendSystemMessage(context, {
          text: strings.worker.bot.commandExecutionFailed,
          replyToMessageId: message.message_id,
        })
      }

      return
    }

    const repliedMessageId = message.reply_to_message?.message_id
    if (!repliedMessageId) {
      return
    }

    const textResponse = message.text.trim()
    if (textResponse.length === 0) {
      return
    }

    let result: { completed: boolean; unauthorized: boolean }
    try {
      result = await completeOperationFromTextReply({
        prisma: args.prisma,
        operationService: args.operationService,
        chatId,
        userId,
        repliedMessageId,
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
      await sendSystemMessage(context, {
        text: strings.common.accessDenied,
        replyToMessageId: message.message_id,
      })

      return
    }

    if (!result.completed) {
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

    await ensureInteractionContext(args.prisma, context)

    let result: CallbackCompletionResult
    try {
      result = await completeOperationFromCallbackAction({
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

    if (result.accepted) {
      logger.info("callback action accepted for messageId=%s", messageId)
      await clearInlineActions(context, chatId, messageId)
      await appendAcceptedStamp(context, args.prisma)
      return
    }

    logger.debug(
      "callback action not accepted for messageId=%s unauthorized=%s reason=%s",
      messageId,
      result.unauthorized,
      result.reason,
    )

    if (result.reason === "already-responded" || result.reason === "action-not-allowed") {
      await context.answerCallbackQuery()
      return
    }

    await context.answerCallbackQuery({
      text: result.unauthorized ? strings.common.accessDenied : strings.worker.bot.unexpectedError,
      show_alert: false,
    })
  })

  await bot.init()
  const commands = await args.prisma.command.findMany({
    orderBy: [{ name: "asc" }],
  })

  await bot.api.setMyCommands(
    commands.map(command => ({
      command: command.name,
      description: command.title,
    })),
  )

  return bot
}

export function parseCommandInvocation(text: string): {
  name: string
  parameters: string[]
} | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith("/")) {
    return null
  }

  const parts = trimmed.slice(1).split(/\s+/).filter(Boolean)
  const [rawCommand, ...args] = parts
  if (!rawCommand) {
    return null
  }

  const commandName = rawCommand.split("@")[0]?.trim()
  if (!commandName) {
    return null
  }

  return {
    name: commandName,
    parameters: args,
  }
}

export function parseStoredCommandParameters(raw: unknown): CommandParameter[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
    )
    .map(entry => ({
      name: typeof entry.name === "string" ? entry.name : "",
      title: typeof entry.title === "string" ? entry.title : "",
      description: typeof entry.description === "string" ? entry.description : undefined,
      type:
        typeof entry.type === "number" &&
        (entry.type === CommandParameterType.STRING ||
          entry.type === CommandParameterType.INTEGER ||
          entry.type === CommandParameterType.BOOLEAN)
          ? entry.type
          : CommandParameterType.STRING,
      required: entry.required === true,
      rest: entry.rest === true,
    }))
    .filter(parameter => parameter.name.length > 0 && parameter.title.length > 0)
}

export function parseCommandParameters(
  rawParameters: unknown,
  values: string[],
): Record<string, unknown> {
  const definitions = parseStoredCommandParameters(rawParameters)
  assertRestParameterShape(definitions)

  const params: Record<string, unknown> = {}
  let valueIndex = 0

  for (const definition of definitions) {
    if (!definition) {
      continue
    }

    if (definition.rest === true) {
      const restValue = values.slice(valueIndex).join(" ")
      if (restValue.length > 0) {
        params[definition.name] = parseCommandParameterValue(definition, restValue)
      } else if (definition.required === true) {
        throw new Error(strings.worker.bot.parameterRequired(definition.name))
      }

      break
    }

    const value = values[valueIndex]
    if (value === undefined) {
      if (definition.required === true) {
        throw new Error(strings.worker.bot.parameterRequired(definition.name))
      }

      valueIndex++
      continue
    }

    params[definition.name] = parseCommandParameterValue(definition, value)
    valueIndex++
  }

  return params
}

function parseCommandParameterValue(definition: CommandParameter, value: string): unknown {
  if (definition.type === CommandParameterType.INTEGER) {
    const parsedValue = Number(value)
    if (!Number.isInteger(parsedValue)) {
      throw new Error(strings.worker.bot.parameterMustBeInteger(definition.name))
    }

    return parsedValue
  }

  if (definition.type === CommandParameterType.BOOLEAN) {
    if (value === "true" || value === "1") {
      return true
    }

    if (value === "false" || value === "0") {
      return false
    }

    throw new Error(strings.worker.bot.parameterMustBeBoolean(definition.name))
  }

  return value
}

function assertRestParameterShape(definitions: CommandParameter[]): void {
  const restIndexes: number[] = []

  for (let index = 0; index < definitions.length; index++) {
    if (definitions[index]?.rest === true) {
      restIndexes.push(index)
    }
  }

  if (
    restIndexes.length <= 1 &&
    (restIndexes.length === 0 || restIndexes[0] === definitions.length - 1)
  ) {
    return
  }

  throw new Error(strings.worker.bot.commandExecutionFailed)
}

async function ensureInteractionContext(
  prisma: PrismaClient,
  context: Context,
  options?: {
    lastUserMessageId?: number
  },
): Promise<{ id: number; title: string }> {
  const chat = context.chat
  const user = context.from

  const chatId = chat?.id ? String(chat.id) : null
  const userId = user?.id ? String(user.id) : null

  const chatEntity =
    chatId === null
      ? null
      : await prisma.chat.upsert({
          where: {
            telegramId: chatId,
          },
          create: {
            telegramId: chatId,
            data: chat as unknown as PrismaJson.ChatData,
          },
          update: {
            data: chat as unknown as PrismaJson.ChatData,
          },
          select: {
            id: true,
          },
        })

  const userEntity =
    userId === null
      ? null
      : await prisma.user.upsert({
          where: {
            telegramId: userId,
          },
          create: {
            telegramId: userId,
            data: user as unknown as PrismaJson.UserData,
          },
          update: {
            data: user as unknown as PrismaJson.UserData,
          },
          select: {
            id: true,
          },
        })

  const type: "SYSTEM" | "CHAT" | "USER_PRIVATE" | "USER_IN_CHAT" = !chat
    ? "SYSTEM"
    : chat.type === "private"
      ? "USER_PRIVATE"
      : userId
        ? "USER_IN_CHAT"
        : "CHAT"

  const normalizedChatId = type === "USER_PRIVATE" ? null : (chatEntity?.id ?? null)
  const normalizedUserId = type === "CHAT" || type === "SYSTEM" ? null : (userEntity?.id ?? null)

  const existing = await prisma.interactionContext.findFirst({
    where: {
      type,
      chatId: normalizedChatId,
      userId: normalizedUserId,
    },
    select: {
      id: true,
    },
  })

  let interactionContext = existing

  if (!interactionContext) {
    try {
      interactionContext = await prisma.interactionContext.create({
        data: {
          type,
          chatId: normalizedChatId,
          userId: normalizedUserId,
          lastUserMessageId: type === "USER_IN_CHAT" ? (options?.lastUserMessageId ?? null) : null,
        },
        select: {
          id: true,
        },
      })
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error
      }

      interactionContext = await prisma.interactionContext.findFirst({
        where: {
          type,
          chatId: normalizedChatId,
          userId: normalizedUserId,
        },
        select: {
          id: true,
        },
      })

      if (!interactionContext) {
        throw error
      }
    }
  }

  if (type === "USER_IN_CHAT" && options?.lastUserMessageId !== undefined) {
    await prisma.interactionContext.update({
      where: {
        id: interactionContext.id,
      },
      data: {
        lastUserMessageId: options.lastUserMessageId,
      },
    })
  }

  const title =
    type === "USER_PRIVATE"
      ? formatUserTitle(user)
      : type === "USER_IN_CHAT"
        ? `${formatChatTitle(chat)} / ${formatUserTitle(user)}`
        : formatChatTitle(chat)

  return {
    id: interactionContext.id,
    title,
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return "code" in error && error.code === "P2002"
}

async function appendAcceptedStamp(context: Context, prisma: PrismaClient): Promise<void> {
  const callbackMessage = context.callbackQuery?.message
  const chatId = callbackMessage?.chat.id
  const messageId = callbackMessage?.message_id

  if (!chatId || !messageId) {
    return
  }

  const notification = await prisma.notification.findFirst({
    where: {
      messageId,
    },
    select: {
      title: true,
      content: true,
    },
    orderBy: {
      id: "desc",
    },
  })

  if (!notification) {
    logger.warn({ chatId, messageId }, "notification not found for accepted stamp rendering")
    return
  }

  const subjectTitle = formatUserTitle(context.from)
  const { date, time } = formatMskDateTime(new Date())
  const renderedNotification = renderStoredNotificationMessage(notification)
  const suffix = bold(italic(strings.worker.bot.acceptedSuffix(subjectTitle, date, time)))
  const updatedMessage = block(renderedNotification, "", suffix).html

  try {
    await context.api.editMessageText(chatId, messageId, updatedMessage, {
      parse_mode: "HTML",
      link_preview_options: {
        is_disabled: true,
      },
      reply_markup: {
        inline_keyboard: [],
      },
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

function renderSystemMessageHeaderElement(): MessageElement {
  return block(
    inline(
      customEmoji(SYSTEM_MESSAGE_HEADER_EMOJI_FIRST_ID),
      customEmoji(SYSTEM_MESSAGE_HEADER_EMOJI_SECOND_ID),
      SPACE,
      bold(getSystemReplicaName()),
    ),
    inline(
      customEmoji(SYSTEM_MESSAGE_HEADER_EMOJI_THIRD_ID),
      customEmoji(SYSTEM_MESSAGE_HEADER_EMOJI_FOURTH_ID),
      SPACE,
      code(getSystemReplicaSubjectId()),
    ),
  )
}

function renderStoredNotificationMessage(input: {
  title: string
  content: string
}): MessageElement {
  const header = renderSystemMessageHeaderElement()
  const content = input.content.trim()
  if (content.length > 0) {
    return block(header, "", bold(input.title), { html: content })
  }

  return block(header, "", bold(input.title))
}

async function sendSystemMessage(
  context: Context,
  args: {
    text: string
    replyToMessageId?: number
  },
): Promise<void> {
  const message = block(renderSystemMessageHeaderElement(), "", args.text).html

  await context.reply(message, {
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
  try {
    await context.api.editMessageReplyMarkup(chatId, messageId, {
      reply_markup: {
        inline_keyboard: [],
      },
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
