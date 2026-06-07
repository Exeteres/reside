import { z } from "zod"

export const encryptedStringSchema = z.string()

export const telegramSentMessageSchema = z
  .object({
    message_id: z.number(),
    chat: z
      .object({
        id: z.union([z.string(), z.number()]),
      })
      .passthrough(),
  })
  .passthrough()

export type TelegramSentMessage = z.infer<typeof telegramSentMessageSchema>

export const telegramUserDataSchema = z
  .object({
    username: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
  })
  .passthrough()

export function getTelegramMessageChatId(message: TelegramSentMessage): string {
  return String(message.chat.id)
}
