import type { InputFile } from "grammy"
import type { InlineKeyboardMarkup, InputMediaDocument, InputMediaPhoto } from "grammy/types"

export type Action = {
  name: string
  title: string
  url?: string
}

export type ActionRow = {
  actions: Action[]
}

export type NotificationStatus = "REGULAR" | "PLANNING" | "IN_PROGRESS" | "COMPLETED" | "FAILED"

export type NotificationTaskStatus =
  | "PLANNED"
  | "PENDING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED"

export type NotificationTaskInput = {
  id: string
  title: string
  status: NotificationTaskStatus
}

export type NotificationTaskGroupInput = {
  id: string
  title: string
  tasks: NotificationTaskInput[]
}

export type NotificationFileInput = {
  content: Uint8Array
  name: string
}

export type NotificationImageUrlInput = {
  url: string
}

export type NotificationKeyboardOptions = {
  status?: NotificationStatus
}

type TelegramSeenReaction = {
  type: "emoji"
  emoji: "👀"
}

export type SendNotificationInput = {
  channel?: string
  title: string
  content?: string
  actionRows: ActionRow[]
  images: NotificationFileInput[]
  imageUrls?: NotificationImageUrlInput[]
  attachments: NotificationFileInput[]
  contextToken?: string
  sendAsSubjectId?: string
  requiresTextResponse?: boolean
  protected?: boolean
  protectedForSubjectId?: string
  expectImmediateFeedback?: boolean
  topicId?: string
  acquireTopic?: boolean
  acceptedDiceEmojis?: string[]
  status?: NotificationStatus
  taskGroups?: NotificationTaskGroupInput[]
  stickerFileId?: string
}

export type UpdateNotificationInput = {
  notificationId: string
  title: string
  content: string
  actionRows: ActionRow[]
  requiresTextResponse?: boolean
  expectImmediateFeedback?: boolean
  protectedForSubjectId?: string
  acceptedDiceEmojis?: string[]
  acquireTopic?: boolean
  status?: NotificationStatus
  taskGroups?: NotificationTaskGroupInput[]
  imageUrls?: NotificationImageUrlInput[]
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
        message_thread_id?: number
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
    editMessageMedia?(
      chatId: string,
      messageId: number,
      media: InputMediaPhoto,
      options?: {
        reply_markup?: InlineKeyboardMarkup
      },
    ): Promise<unknown>
    deleteMessage(chatId: string, messageId: number): Promise<true>
    setMessageReaction?(
      chatId: string,
      messageId: number,
      reaction: TelegramSeenReaction[],
    ): Promise<true>
    sendPhoto(
      chatId: string,
      photo: InputFile | string,
      options?: {
        caption?: string
        parse_mode?: "HTML"
        show_caption_above_media?: boolean
        reply_parameters?: {
          message_id: number
        }
        message_thread_id?: number
      },
    ): Promise<{ message_id: number }>
    sendDocument(
      chatId: string,
      document: InputFile,
      options?: {
        reply_parameters?: {
          message_id: number
        }
        message_thread_id?: number
      },
    ): Promise<{ message_id: number }>
    sendMediaGroup(
      chatId: string,
      media: (InputMediaPhoto | InputMediaDocument)[],
      options?: {
        reply_parameters?: {
          message_id: number
        }
        message_thread_id?: number
      },
    ): Promise<{ message_id: number }[]>
    sendSticker?(
      chatId: string,
      sticker: string,
      options?: {
        reply_parameters?: {
          message_id: number
        }
        message_thread_id?: number
      },
    ): Promise<{ message_id: number }>
    createForumTopic?(chatId: string, name: string): Promise<{ message_thread_id: number }>
    editForumTopic?(
      chatId: string,
      messageThreadId: number,
      options: { name: string },
    ): Promise<true>
    closeForumTopic?(chatId: string, messageThreadId: number): Promise<true>
    reopenForumTopic?(chatId: string, messageThreadId: number): Promise<true>
    deleteForumTopic?(chatId: string, messageThreadId: number): Promise<true>
  }
}
