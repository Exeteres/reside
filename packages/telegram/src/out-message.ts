import type { InlineKeyboardMarkup, InputFile, Message, ReplyKeyboardMarkup } from "grammy/types"
import type { Logger } from "pino"
import { type Api, type Context, GrammyError, InlineKeyboard } from "grammy"
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

export function sendMessageInternal(
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

export function editMessageInChat(
  chatId: number,
  oldMessage: number | Message,
  message: EditOutMessage,
  api: Api,
  logger: Logger,
): Promise<Message> {
  return editMessageInternal(
    api,
    logger,
    chatId,
    typeof oldMessage === "number" ? oldMessage : oldMessage.message_id,
    message,
    typeof oldMessage === "number" ? undefined : oldMessage,
  )
}

/**
 * Removes all HTML tags from the text replcaing them with the plain text.
 */
function unwrapHtml(text: string): string {
  return text.replace(/<[^>]+>/g, "")
}

function unescapeHtml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

function cleanText(text: string): string {
  return unescapeHtml(unwrapHtml(text)).trim()
}

async function editMessageInternal(
  api: Api,
  logger: Logger,
  chatId: number,
  messageId: number,
  message: EditOutMessage,
  oldMessage?: Message,
): Promise<Message> {
  const replyMarkup = resolveReplyMarkup(message)
  const inlineReplyMarkup =
    replyMarkup && "inline_keyboard" in replyMarkup ? replyMarkup : undefined
  const text = isMessageElement(message.text) ? message.text.value : message.text

  try {
    if (
      oldMessage &&
      (text ? oldMessage.text?.trim() === cleanText(text) : !oldMessage.text) &&
      JSON.stringify(oldMessage.reply_markup) === JSON.stringify(replyMarkup)
    ) {
      // prevent editing the message if it's not changed
      return oldMessage
    }

    if (message.photo) {
      const result = await api.editMessageMedia(chatId, messageId, {
        type: "photo",
        media: message.photo,
        caption: text,
        parse_mode: "HTML",
      })

      if (inlineReplyMarkup) {
        await api.editMessageReplyMarkup(chatId, messageId, {
          reply_markup: inlineReplyMarkup,
        })
      }

      return result as Message
    }

    if (message.video) {
      const result = await api.editMessageMedia(chatId, messageId, {
        type: "video",
        media: message.video,
        caption: text,
        parse_mode: "HTML",
      })

      if (inlineReplyMarkup) {
        await api.editMessageReplyMarkup(chatId, messageId, {
          reply_markup: inlineReplyMarkup,
        })
      }

      return result as Message
    }

    if (!text) {
      if (inlineReplyMarkup) {
        const result = await api.editMessageReplyMarkup(chatId, messageId, {
          reply_markup: inlineReplyMarkup,
        })

        return result as Message
      }

      throw new Error("Text is required if no attachments are provided")
    }

    const result = await api.editMessageText(chatId, messageId, text, {
      parse_mode: "HTML",
      reply_markup: inlineReplyMarkup,
    })

    return result as Message
  } catch (error) {
    if (error instanceof GrammyError && error.description.includes("message is not modified")) {
      logger.error(
        {
          messageId: messageId,
          text: message.text,
          buttons: message.buttons,
          oldText: oldMessage?.text,
          oldButtons: oldMessage?.reply_markup,
        },
        "failed to edit message: message is not modified",
      )
    }

    throw error
  }
}
