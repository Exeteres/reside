import type { Span } from "@opentelemetry/api"
import type { Context } from "grammy"
import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api"
import { Bot } from "grammy"

const telegramBotApiTracer = trace.getTracer("reside.telegram.bot-api")

export function createTelegramBotClient(
  token: string,
  options?: {
    role?: string
  },
): Bot<Context> {
  const bot = new Bot(token)

  bot.api.config.use(async (prev, method, payload, signal) => {
    const methodName = String(method)

    return await telegramBotApiTracer.startActiveSpan(
      `telegram.api.${methodName}`,
      {
        kind: SpanKind.CLIENT,
        attributes: getBaseApiCallAttributes(methodName, options?.role),
      },
      async span => {
        applyPayloadAttributes(span, payload)

        try {
          const result = await prev(method, payload, signal)
          span.setStatus({
            code: SpanStatusCode.OK,
          })

          return result
        } catch (error) {
          if (error instanceof Error) {
            span.recordException(error)
          }

          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          })

          throw error
        } finally {
          span.end()
        }
      },
    )
  })

  return bot
}

function getBaseApiCallAttributes(methodName: string, role: string | undefined) {
  if (role) {
    return {
      "http.url": `https://api.telegram.org/botXXX/${methodName}`,
      "rpc.system": "telegram-bot-api",
      "rpc.service": "BotAPI",
      "rpc.method": methodName,
      "reside.telegram.role": role,
    }
  }

  return {
    "http.url": `https://api.telegram.org/botXXX/${methodName}`,
    "rpc.system": "telegram-bot-api",
    "rpc.service": "BotAPI",
    "rpc.method": methodName,
  }
}

function applyPayloadAttributes(span: Span, payload: unknown): void {
  if (!isRecord(payload)) {
    return
  }

  const chatId = getPayloadNumberOrString(payload, "chat_id")
  if (chatId !== undefined) {
    span.setAttribute("reside.telegram.chat_id", chatId)
  }

  const messageId = getPayloadNumberOrString(payload, "message_id")
  if (messageId !== undefined) {
    span.setAttribute("reside.telegram.message_id", messageId)
  }

  const replyMessageId = getReplyMessageId(payload)
  if (replyMessageId !== undefined) {
    span.setAttribute("reside.telegram.reply_to_message_id", replyMessageId)
  }
}

function getReplyMessageId(payload: Record<string, unknown>): number | undefined {
  const replyParameters = payload.reply_parameters
  if (!isRecord(replyParameters)) {
    return undefined
  }

  return getPayloadNumber(replyParameters, "message_id")
}

function getPayloadNumberOrString(
  payload: Record<string, unknown>,
  key: string,
): number | string | undefined {
  const value = payload[key]
  if (typeof value === "number" || typeof value === "string") {
    return value
  }

  return undefined
}

function getPayloadNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key]
  if (typeof value === "number") {
    return value
  }

  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
