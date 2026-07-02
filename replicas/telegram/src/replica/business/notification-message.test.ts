import { describe, expect, test } from "bun:test"
import {
  assertChannelName,
  isReplyTargetMessageMissingError,
  toInlineKeyboardMarkupFromActionRows,
  toReplyParameters,
  toTelegramMessageTextValue,
} from "./notification-message"

describe("notification message helpers", () => {
  test("assertChannelName throws for empty value", () => {
    expect(() => assertChannelName("")).toThrow("Channel name must not be empty")
  })

  test("toInlineKeyboardMarkupFromActionRows maps callback and url actions", () => {
    const markup = toInlineKeyboardMarkupFromActionRows([
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
    ])

    expect(markup).toEqual({
      inline_keyboard: [
        [
          {
            callback_data: "approve",
            text: "Approve",
          },
          {
            text: "Docs",
            url: "https://example.com",
          },
        ],
      ],
    })
  })

  test("toInlineKeyboardMarkupFromActionRows appends planning edit button", () => {
    const markup = toInlineKeyboardMarkupFromActionRows(
      [
        {
          actions: [
            {
              name: "approve",
              title: "Approve",
            },
          ],
        },
      ],
      { status: "PLANNING" },
    )

    expect(markup).toEqual({
      inline_keyboard: [
        [
          {
            callback_data: "approve",
            text: "Approve",
          },
        ],
        [
          {
            callback_data: "__reside_edit_tasks__",
            text: "Изменить задачи",
          },
        ],
      ],
    })
  })

  test("toInlineKeyboardMarkupFromActionRows renders planning edit button without actions", () => {
    const markup = toInlineKeyboardMarkupFromActionRows([], { status: "PLANNING" })

    expect(markup).toEqual({
      inline_keyboard: [
        [
          {
            callback_data: "__reside_edit_tasks__",
            text: "Изменить задачи",
          },
        ],
      ],
    })
  })

  test("toReplyParameters returns undefined when message id is missing", () => {
    expect(toReplyParameters(undefined)).toBeUndefined()
    expect(toReplyParameters(321)).toEqual({ message_id: 321 })
  })

  test("toTelegramMessageTextValue renders sender when enabled", () => {
    const text = toTelegramMessageTextValue(
      {
        title: "Title",
        content: "Body",
      },
      "Sender",
      true,
    )

    expect(text).toContain("Sender")
    expect(text).toContain("Title")
    expect(text).toContain("Body")
  })

  test("toTelegramMessageTextValue renders notification and task statuses", () => {
    const text = toTelegramMessageTextValue(
      {
        title: "Title",
        content: "Body",
        status: "IN_PROGRESS",
        taskGroups: [
          {
            id: "group-1",
            title: "Task Group",
            tasks: [
              {
                id: "task-1",
                title: "task1",
                status: "PLANNED",
              },
              {
                id: "task-2",
                title: "task2",
                status: "SKIPPED",
              },
            ],
          },
        ],
      },
      "Sender",
      false,
    )

    expect(text).toContain("🔄 Title")
    expect(text).toContain("📝 Task Group")
    expect(text).toContain("- 📝 task1")
    expect(text).toContain("- ⏭️ task2")
  })

  test("isReplyTargetMessageMissingError detects missing reply target", () => {
    expect(
      isReplyTargetMessageMissingError(new Error("Message to be replied not found")),
    ).toBeTrue()
    expect(isReplyTargetMessageMissingError(new Error("other"))).toBeFalse()
  })
})
