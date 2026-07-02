import type { InlineKeyboardMarkup } from "grammy/types"
import type {
  ActionRow,
  NotificationKeyboardOptions,
  NotificationStatus,
  NotificationTaskGroupInput,
  NotificationTaskStatus,
} from "./notification-types"
import { Code, ConnectError } from "@connectrpc/connect"
import { block, bold } from "@reside/common"
import { GrammyError } from "grammy"
import { strings } from "../../locale"

export const EDIT_NOTIFICATION_TASKS_ACTION = "__reside_edit_tasks__"

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

export function collectCallbackActions(actionRows: ActionRow[]): { name: string; title: string }[] {
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
    status?: NotificationStatus
    taskGroups?: NotificationTaskGroupInput[]
  },
  senderTitle: string,
  includeSenderTitle: boolean,
): string {
  return toTelegramMessageTextValue(
    {
      title: request.title,
      content: request.content,
      status: request.status,
      taskGroups: request.taskGroups,
    },
    senderTitle,
    includeSenderTitle,
  )
}

export function toTelegramMessageTextValue(
  input: {
    title: string
    content: string | undefined
    status?: NotificationStatus
    taskGroups?: NotificationTaskGroupInput[]
  },
  senderTitle: string,
  includeSenderTitle: boolean,
): string {
  const content = input.content?.trim()
  const title = `${getStatusIcon(input.status ?? "REGULAR")} ${input.title}`.trim()
  const taskRows = renderTaskGroups(input.taskGroups ?? [])

  if (includeSenderTitle) {
    if (content) {
      return block(bold(senderTitle), "", bold(title), "", { html: content }, ...taskRows).html
    }

    return block(bold(senderTitle), "", bold(title), ...taskRows).html
  }

  if (content) {
    return block(bold(title), "", { html: content }, ...taskRows).html
  }

  return block(bold(title), ...taskRows).html
}

export function getStatusIcon(status: NotificationStatus | NotificationTaskStatus): string {
  switch (status) {
    case "PLANNING":
    case "PLANNED":
      return "📝"
    case "PENDING":
      return "⏳"
    case "IN_PROGRESS":
      return "🔄"
    case "COMPLETED":
      return "✅"
    case "FAILED":
      return "❌"
    case "SKIPPED":
      return "⏭️"
    case "REGULAR":
      return ""
  }
}

function renderTaskGroups(taskGroups: NotificationTaskGroupInput[]): string[] {
  if (taskGroups.length === 0) {
    return []
  }

  const rows: string[] = [""]

  for (const group of taskGroups) {
    rows.push(bold(`${getStatusIcon(getTaskGroupStatus(group.tasks))} ${group.title}`).html)

    for (const task of group.tasks) {
      rows.push(`- ${getStatusIcon(task.status)} ${task.title}`)
    }
  }

  return rows
}

function getTaskGroupStatus(tasks: NotificationTaskGroupInput["tasks"]): NotificationTaskStatus {
  if (tasks.length === 0) {
    return "SKIPPED"
  }

  if (tasks.some(task => task.status === "FAILED")) {
    return "FAILED"
  }

  if (tasks.some(task => task.status === "IN_PROGRESS")) {
    return "IN_PROGRESS"
  }

  if (tasks.some(task => task.status === "PENDING")) {
    return "PENDING"
  }

  if (tasks.every(task => task.status === "COMPLETED" || task.status === "SKIPPED")) {
    return "COMPLETED"
  }

  return "PLANNED"
}

export function toInlineKeyboardMarkupFromActionRows(
  actionRows: ActionRow[],
  options?: NotificationKeyboardOptions,
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

  if (options?.status === "PLANNING") {
    rows.push([
      {
        text: strings.server.notification.editTasks,
        callback_data: EDIT_NOTIFICATION_TASKS_ACTION,
      },
    ])
  }

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
