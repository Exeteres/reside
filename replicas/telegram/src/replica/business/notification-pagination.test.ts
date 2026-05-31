import { describe, expect, test } from "bun:test"
import {
  buildNotificationInlineKeyboard,
  getNotificationCallbackActionNames,
  isNotificationPaginationActionName,
  parseNotificationPaginationActionPage,
} from "./notification-pagination"

describe("getNotificationCallbackActionNames", () => {
  test("collects only callback actions and skips URL actions", () => {
    const actionNames = getNotificationCallbackActionNames([
      {
        actions: [
          {
            name: "approve",
            title: "Approve",
          },
          {
            name: "docs",
            title: "Docs",
            url: "https://example.com",
          },
        ],
      },
      {
        actions: [
          {
            name: "reject",
            title: "Reject",
          },
        ],
      },
    ])

    expect(actionNames).toEqual(["approve", "reject"])
  })
})

describe("pagination action names", () => {
  test("detects pagination action names", () => {
    expect(isNotificationPaginationActionName("__reside_page__1")).toBeTrue()
    expect(isNotificationPaginationActionName("approve")).toBeFalse()
  })

  test("parses page index from action name", () => {
    expect(parseNotificationPaginationActionPage("__reside_page__0")).toBe(0)
    expect(parseNotificationPaginationActionPage("__reside_page__5")).toBe(5)
    expect(parseNotificationPaginationActionPage("__reside_page__-1")).toBeUndefined()
    expect(parseNotificationPaginationActionPage("approve")).toBeUndefined()
  })
})

describe("buildNotificationInlineKeyboard", () => {
  test("returns undefined for empty rows", () => {
    expect(buildNotificationInlineKeyboard([], 0)).toBeUndefined()
  })

  test("builds keyboard with callback and URL buttons", () => {
    const keyboard = buildNotificationInlineKeyboard(
      [
        {
          actions: [
            {
              name: "approve",
              title: "Approve",
            },
            {
              name: "docs",
              title: "Docs",
              url: "https://example.com",
            },
          ],
        },
      ],
      0,
    )

    expect(keyboard).toEqual({
      inline_keyboard: [
        [
          {
            text: "Approve",
            callback_data: "approve",
          },
          {
            text: "Docs",
            url: "https://example.com",
          },
        ],
      ],
    })
  })

  test("adds pager controls for multiple pages", () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      actions: [
        {
          name: `a${index}`,
          title: `A${index}`,
        },
      ],
    }))

    const firstPage = buildNotificationInlineKeyboard(rows, 0)
    const secondPage = buildNotificationInlineKeyboard(rows, 1)

    expect(firstPage?.inline_keyboard.at(-1)).toEqual([
      {
        text: ">",
        callback_data: "__reside_page__1",
      },
    ])

    expect(secondPage?.inline_keyboard.at(-1)).toEqual([
      {
        text: "<",
        callback_data: "__reside_page__0",
      },
    ])
  })
})
