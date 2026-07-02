import type { NotificationActionRowJson } from "@reside/api/interaction/notification.v1"
import type { InlineKeyboardMarkup } from "grammy/types"
import type { NotificationKeyboardOptions } from "./notification-types"
import { strings } from "../../locale"
import { EDIT_NOTIFICATION_TASKS_ACTION } from "./notification-message"

const MAX_ROWS_PER_PAGE = 5
const PAGINATION_ACTION_PREFIX = "__reside_page__"

export function getNotificationCallbackActionNames(
  actionRows: NotificationActionRowJson[],
): string[] {
  const callbackActionNames: string[] = []

  for (const row of actionRows) {
    for (const action of row.actions ?? []) {
      if (action.url !== undefined) {
        continue
      }

      if (typeof action.name !== "string") {
        continue
      }

      callbackActionNames.push(action.name)
    }
  }

  return callbackActionNames
}

export function buildNotificationInlineKeyboard(
  actionRows: NotificationActionRowJson[],
  pageIndex: number,
  options?: NotificationKeyboardOptions,
): InlineKeyboardMarkup | undefined {
  if (actionRows.length === 0) {
    return options?.status === "PLANNING"
      ? {
          inline_keyboard: [
            [
              {
                text: strings.server.notification.editTasks,
                callback_data: EDIT_NOTIFICATION_TASKS_ACTION,
              },
            ],
          ],
        }
      : undefined
  }

  const pages = splitRowsIntoPages(actionRows)
  const clampedPageIndex = clampPageIndex(pageIndex, pages.length)
  const currentPage = pages[clampedPageIndex]

  if (!currentPage) {
    return undefined
  }

  const keyboardRows: InlineKeyboardMarkup["inline_keyboard"] = []

  for (const row of currentPage) {
    const keyboardRow: InlineKeyboardMarkup["inline_keyboard"][number] = []

    for (const action of row.actions ?? []) {
      if (typeof action.title !== "string") {
        continue
      }

      if (typeof action.url === "string") {
        keyboardRow.push({
          text: action.title,
          url: action.url,
        })
        continue
      }

      if (typeof action.name !== "string") {
        continue
      }

      keyboardRow.push({
        text: action.title,
        callback_data: action.name,
      })
    }

    if (keyboardRow.length > 0) {
      keyboardRows.push(keyboardRow)
    }
  }

  if (pages.length > 1) {
    const navigationRow: { text: string; callback_data: string }[] = []

    if (clampedPageIndex > 0) {
      navigationRow.push({
        text: "<",
        callback_data: createPaginationActionName(clampedPageIndex - 1),
      })
    }

    if (clampedPageIndex < pages.length - 1) {
      navigationRow.push({
        text: ">",
        callback_data: createPaginationActionName(clampedPageIndex + 1),
      })
    }

    if (navigationRow.length > 0) {
      keyboardRows.push(navigationRow)
    }
  }

  if (options?.status === "PLANNING") {
    keyboardRows.push([
      {
        text: strings.server.notification.editTasks,
        callback_data: EDIT_NOTIFICATION_TASKS_ACTION,
      },
    ])
  }

  return {
    inline_keyboard: keyboardRows,
  }
}

export function isNotificationPaginationActionName(actionName: string): boolean {
  return actionName.startsWith(PAGINATION_ACTION_PREFIX)
}

export function parseNotificationPaginationActionPage(actionName: string): number | undefined {
  if (!isNotificationPaginationActionName(actionName)) {
    return undefined
  }

  const rawPage = actionName.slice(PAGINATION_ACTION_PREFIX.length)
  const parsedPage = Number(rawPage)
  if (!Number.isInteger(parsedPage) || parsedPage < 0) {
    return undefined
  }

  return parsedPage
}

function createPaginationActionName(pageIndex: number): string {
  return `${PAGINATION_ACTION_PREFIX}${pageIndex}`
}

function splitRowsIntoPages(
  actionRows: NotificationActionRowJson[],
): NotificationActionRowJson[][] {
  const pages: NotificationActionRowJson[][] = []

  for (let rowIndex = 0; rowIndex < actionRows.length; rowIndex += MAX_ROWS_PER_PAGE) {
    pages.push(actionRows.slice(rowIndex, rowIndex + MAX_ROWS_PER_PAGE))
  }

  return pages
}

function clampPageIndex(pageIndex: number, pageCount: number): number {
  if (pageCount <= 0) {
    return 0
  }

  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    return 0
  }

  if (pageIndex >= pageCount) {
    return pageCount - 1
  }

  return pageIndex
}
