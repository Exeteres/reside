import type { InputFile } from "grammy"
import type { InlineKeyboardMarkup, InputMediaDocument, InputMediaPhoto } from "grammy/types"

export type ActionRow = {
  actions: Array<{
    name: string
    title: string
    url?: string
  }>
}

export type SendNotificationInput = {
  channel: string
  title: string
  content?: string
  actionRows: ActionRow[]
  images: Array<{ content: Uint8Array; name: string }>
  attachments: Array<{ content: Uint8Array; name: string }>
  contextToken?: string
  sendAsSubjectId?: string
  requiresTextResponse?: boolean
  protected?: boolean
}

export type UpdateNotificationInput = {
  notificationId: string
  title: string
  content: string
  actionRows: ActionRow[]
  requiresTextResponse?: boolean
}

export type AuthzServiceClientLike = {
  checkPermission(args: {
    permissionName: string
    subjectId: string
    scope: string
  }): Promise<{ authorized: boolean }>
}

export type SubjectServiceClientLike = {
  getSubjectDisplayInfo(args: { subjectId: string }): Promise<{ title: string }>
}

export type TelegramBotLike = {
  api: {
    sendMessage(
      chatId: string,
      text: string,
      options?: {
        parse_mode?: "HTML"
        link_preview_options?: {
          is_disabled: true
        }
        reply_markup?: InlineKeyboardMarkup
        reply_parameters?: {
          message_id: number
        }
      },
    ): Promise<{ message_id: number }>
    editMessageText(
      chatId: string,
      messageId: number,
      text: string,
      options?: {
        parse_mode?: "HTML"
        link_preview_options?: {
          is_disabled: true
        }
        reply_markup?: InlineKeyboardMarkup
      },
    ): Promise<unknown>
    deleteMessage(chatId: string, messageId: number): Promise<true>
    sendPhoto(
      chatId: string,
      photo: InputFile,
      options?: {
        caption?: string
        parse_mode?: "HTML"
        show_caption_above_media?: boolean
        reply_parameters?: {
          message_id: number
        }
      },
    ): Promise<{ message_id: number }>
    sendDocument(
      chatId: string,
      document: InputFile,
      options?: {
        reply_parameters?: {
          message_id: number
        }
      },
    ): Promise<{ message_id: number }>
    sendMediaGroup(
      chatId: string,
      media: Array<InputMediaPhoto | InputMediaDocument>,
      options?: {
        reply_parameters?: {
          message_id: number
        }
      },
    ): Promise<{ message_id: number }[]>
  }
}
