import type { NotificationServiceClient } from "@reside/api/interaction/notification.v1"
import { describe, expect, test } from "bun:test"
import { mockDeepFn } from "@reside/common/testing"
import { appendProgressLine, createProgressReporter, normalizeProgressLine } from "./task-progress"

describe("normalizeProgressLine", () => {
  test("uses first non-empty line and normalizes punctuation", () => {
    expect(normalizeProgressLine("\n  Checking files...\nDone")).toBe("checking files")
  })

  test("returns undefined for blank input", () => {
    expect(normalizeProgressLine(" \n ")).toBeUndefined()
  })
})

describe("appendProgressLine", () => {
  test("keeps only recent progress lines", () => {
    const lines: string[] = []

    for (let index = 1; index <= 7; index += 1) {
      appendProgressLine(lines, `step ${index}`)
    }

    expect(lines).toEqual(["step 3", "step 4", "step 5", "step 6", "step 7"])
  })
})

describe("createProgressReporter", () => {
  test("updates notification with normalized progress and actions", async () => {
    const notificationService = mockDeepFn<NotificationServiceClient>()
    const reporter = createProgressReporter(
      notificationService,
      "notification-1",
      "Working",
      "Wait",
      [
        {
          name: "cancel",
          title: "Cancel",
        },
      ],
    )

    await reporter("  Cloning repository...  ")

    expect(notificationService.updateNotification.spy()).toHaveBeenCalledWith({
      notificationId: "notification-1",
      title: "Working",
      content: "Wait\n\n> cloning repository",
      actionRows: [
        {
          actions: [
            {
              name: "cancel",
              title: "Cancel",
            },
          ],
        },
      ],
    })
  })

  test("ignores blank progress", async () => {
    const notificationService = mockDeepFn<NotificationServiceClient>()
    const reporter = createProgressReporter(notificationService, "notification-1", "Working")

    await reporter(" \n ")

    expect(notificationService.updateNotification.spy()).not.toHaveBeenCalled()
  })
})
