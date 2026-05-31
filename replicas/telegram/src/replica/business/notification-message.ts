import type { InlineKeyboardMarkup } from "grammy/types"
import type { ActionRow } from "./notification-types"
import { Code, ConnectError } from "@connectrpc/connect"
import { block, bold } from "@reside/common"
import { GrammyError } from "grammy"

export function toNotificationActionRows(
  actionRows: ActionRow[],
): PrismaJson.NotificationActionRowsData {
  return actionRows.map(row => ({
    actions: row.actions.map(action => ({
      name: action.name,
      title: action.title,
      url: action.url,
    })),
  }))
}

export function collectCallbackActions(
  actionRows: ActionRow[],
): Array<{ name: string; title: string }> {
  return actionRows.flatMap(row =>
    row.actions
      .filter(action => action.url === undefined)
      .map(action => ({
        name: action.name,
        title: action.title,
      })),
  )
}

export function toTelegramMessageText(
  request: {
    title: string
    content?: string
  },
  senderTitle: string,
  includeSenderTitle: boolean,
): string {
  return toTelegramMessageTextValue(
    {
      title: request.title,
      content: request.content,
    },
    senderTitle,
    includeSenderTitle,
  )
}

export function toTelegramMessageTextValue(
  input: {
    title: string
    content: string | undefined
  },
  senderTitle: string,
  includeSenderTitle: boolean,
): string {
  const content = input.content?.trim()

  if (includeSenderTitle) {
    if (content) {
      return block(bold(senderTitle), "", bold(input.title), "", { html: content }).html
    }

    return block(bold(senderTitle), "", bold(input.title)).html
  }

  if (content) {
    return block(bold(input.title), "", { html: content }).html
  }

  return block(bold(input.title)).html
}

export function toInlineKeyboardMarkupFromActionRows(
  actionRows: ActionRow[],
): InlineKeyboardMarkup | undefined {
  const rows = actionRows
    .map(row =>
      row.actions.map(action => {
        if (action.url !== undefined) {
          return {
            text: action.title,
            url: action.url,
          }
        }

        return {
          text: action.title,
          callback_data: action.name,
        }
      }),
    )
    .filter(row => row.length > 0)

  if (rows.length === 0) {
    return undefined
  }

  return {
    inline_keyboard: rows,
  }
}

export function toReplyParameters(
  replyToMessageId: number | undefined,
): { message_id: number } | undefined {
  if (replyToMessageId === undefined) {
    return undefined
  }

  return {
    message_id: replyToMessageId,
  }
}

export function isReplyTargetMessageMissingError(error: unknown): boolean {
  if (error instanceof GrammyError) {
    return error.description.toLowerCase().includes("message to be replied not found")
  }

  if (error instanceof Error) {
    return error.message.toLowerCase().includes("message to be replied not found")
  }

  return String(error).toLowerCase().includes("message to be replied not found")
}

export function assertChannelName(channelName: string): void {
  if (channelName.length > 0) {
    return
  }

  throw new ConnectError("Channel name must not be empty", Code.InvalidArgument)
}
