import type { InlineKeyboardMarkup, InputFile, Message, ReplyKeyboardMarkup } from "grammy/types"
import { type Api, type Context, InlineKeyboard } from "grammy"
import { isMessageElement, type MessageElement } from "./jsx-runtime"

/**
 * The convient type for the message that can be sent to the user.
 */
export type OutMessage = {
  text?: string | MessageElement
  buttons?: InlineKeyboard | ReplyKeyboardMarkup
  photo?: string | InputFile | null
  video?: string | InputFile | null
  other?: Omit<Parameters<Context["reply"]>[1], "parse_mode">
}

/**
 * Sends a message in the chat in the context.
 */
export function sendMessage(ctx: Context, message: OutMessage): Promise<Message> {
  const chatId = ctx.chat?.id

  if (!chatId) {
    throw new Error("Chat is required to send a message")
  }

  return sendMessageInternal(ctx.api, chatId, ctx.msg?.message_thread_id, message)
}

/**
 * Replies to the message in the chat in the context.
 */
export function replyToMessage(ctx: Context, message: OutMessage): Promise<Message> {
  const chatId = ctx.chat?.id

  if (!chatId || !ctx.msg) {
    throw new Error("Chat and message are required to reply to a message")
  }

  return sendMessageInternal(
    ctx.api,
    chatId,
    ctx.msg.is_topic_message ? ctx.msg.message_thread_id : undefined,
    message,
    ctx.msg.message_id,
  )
}

function sendMessageInternal(
  api: Api,
  chatId: number,
  topicId: number | undefined,
  message: OutMessage,
  replyToMessageId?: number,
): Promise<Message> {
  const replyMarkup = resolveReplyMarkup(message)
  const text = isMessageElement(message.text) ? message.text.value : message.text

  if (message.photo) {
    return api.sendPhoto(chatId, message.photo, {
      caption: text,
      reply_markup: replyMarkup,
      message_thread_id: topicId,
      parse_mode: "HTML",
      reply_parameters: replyToMessageId ? { message_id: replyToMessageId } : undefined,
    })
  }

  if (message.video) {
    return api.sendVideo(chatId, message.video, {
      caption: text,
      reply_markup: replyMarkup,
      message_thread_id: topicId,
      reply_parameters: replyToMessageId ? { message_id: replyToMessageId } : undefined,
      parse_mode: "HTML",
    })
  }

  if (!text) {
    throw new Error("Text is required if no attachments are provided")
  }

  return api.sendMessage(chatId, text, {
    reply_markup: replyMarkup,
    message_thread_id: topicId,
    parse_mode: "HTML",
    reply_parameters: replyToMessageId ? { message_id: replyToMessageId } : undefined,
    link_preview_options: {
      is_disabled: true,
    },
  })
}

function resolveReplyMarkup(
  message: EditOutMessage,
): InlineKeyboardMarkup | ReplyKeyboardMarkup | undefined {
  if (!message.buttons) {
    return undefined
  }

  if (message.buttons instanceof InlineKeyboard) {
    return {
      inline_keyboard: message.buttons.inline_keyboard,
    }
  }

  if (message.buttons === "remove") {
    return new InlineKeyboard()
  }

  return {
    keyboard: message.buttons.keyboard,
    resize_keyboard: true,
    one_time_keyboard: true,
  }
}

export type EditOutMessage = Omit<OutMessage, "buttons"> & {
  buttons?: InlineKeyboard | ReplyKeyboardMarkup | "remove" | null
}
