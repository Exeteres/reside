import type { Api } from "grammy"
import type { Message } from "grammy/types"
import type { Logger } from "pino"
import { typedJson } from "@reside/shared"
import { editMessageInChat, type OutMessage, sendMessageInternal } from "@reside/telegram"
import { co, z } from "jazz-tools"

export const LiveMessage = co.map({
  /**
   * The ID of the chat where the live message is sent.
   */
  chatId: z.number(),

  /**
   * The last sent/updated message of the live message.
   */
  message: typedJson<Message>(),
})

export type LiveMessage = co.loaded<typeof LiveMessage>

/**
 * Sends a live message to the specified chat.
 *
 * @param chatId The ID of the chat where the message will be sent.
 * @param outMessage The content of the message to be sent.
 * @param api The Telegram API instance.
 * @returns The created live message.
 */
export async function sendLiveMessage(
  chatId: number,
  outMessage: OutMessage,
  api: Api,
): Promise<LiveMessage> {
  const message = await sendMessageInternal(api, chatId, undefined, outMessage)

  return LiveMessage.create({ chatId, message })
}

/**
 * Updates the live message in the chat.
 *
 * @param liveMessage The live message to update.
 * @param outMessage The new message content.
 * @param api The Telegram API instance.
 * @param logger The logger instance.
 */
export async function updateLiveMessage(
  liveMessage: LiveMessage,
  outMessage: OutMessage,
  api: Api,
  logger: Logger,
): Promise<void> {
  const message = await editMessageInChat(
    liveMessage.chatId,
    liveMessage.message,
    outMessage,
    api,
    logger,
  )

  liveMessage.$jazz.set("message", message)
}

/**
 * Recreates the live message by deleting the old one and sending a new one.
 *
 * @param liveMessage The live message to recreate.
 * @param outMessage The new message content.
 * @param api The Telegram API instance.
 * @param logger The logger instance.
 */
export async function recreateLiveMessage(
  liveMessage: LiveMessage,
  outMessage: OutMessage,
  api: Api,
  logger: Logger,
): Promise<void> {
  // delete old message
  try {
    await api.deleteMessage(liveMessage.chatId, liveMessage.message.message_id)
  } catch (err) {
    logger.warn(
      `failed to delete old live message (chat ID: %d, message ID: %d): %s`,
      liveMessage.chatId,
      liveMessage.message.message_id,
      (err as Error).message,
    )
  }

  // send new message
  const message = await sendMessageInternal(api, liveMessage.chatId, undefined, outMessage)

  liveMessage.$jazz.set("message", message)
}
