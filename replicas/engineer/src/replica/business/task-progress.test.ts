import type { NotificationServiceClient } from "@reside/api/interaction/notification.v1"
import { describe, expect, test } from "bun:test"
import { mockDeepFn } from "@reside/common/testing"
import { createProgressReporter, normalizeProgressText } from "./task-progress"

describe("normalizeProgressText", () => {
  test("trims streamed text without changing content", () => {
    expect(normalizeProgressText("\n  Checking files...\nDone  ")).toBe("Checking files...\nDone")
  })

  test("returns undefined for blank input", () => {
    expect(normalizeProgressText(" \n ")).toBeUndefined()
  })
})

describe("createProgressReporter", () => {
  test("updates notification with latest streamed text and actions", async () => {
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

    await reporter.report({ text: "  Cloning repository...  " })
    await reporter.flush()

    expect(notificationService.updateNotification.spy()).toHaveBeenCalledWith({
      notificationId: "notification-1",
      title: "Working",
      content: "Wait\n\nCloning repository...",
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

  test("escapes progress text before updating notification", async () => {
    const notificationService = mockDeepFn<NotificationServiceClient>()
    const reporter = createProgressReporter(notificationService, "notification-1", "Working")

    await reporter.report({ text: "Use transfer <amount> <user>" })
    await reporter.flush()

    expect(notificationService.updateNotification.spy()).toHaveBeenCalledWith({
      notificationId: "notification-1",
      title: "Working",
      content: "Use transfer &lt;amount&gt; &lt;user&gt;",
      actionRows: [],
    })
  })

  test("does not throw when progress notification update fails", async () => {
    const notificationService = mockDeepFn<NotificationServiceClient>()
    notificationService.updateNotification.mockRejectedValue(new Error("telegram rejected html"))
    const reporter = createProgressReporter(notificationService, "notification-1", "Working")

    await reporter.report({ text: "Use transfer <amount> <user>" })
    await reporter.flush()

    expect(notificationService.updateNotification.spy()).toHaveBeenCalledTimes(2)
  })

  test("coalesces streamed text to latest frame", async () => {
    const notificationService = mockDeepFn<NotificationServiceClient>()
    const reporter = createProgressReporter(notificationService, "notification-1", "Working")

    await reporter.report({ text: "first" })
    await reporter.report({ text: "second" })
    await reporter.flush()

    expect(notificationService.updateNotification.spy()).toHaveBeenLastCalledWith({
      notificationId: "notification-1",
      title: "Working",
      content: "second",
      actionRows: [],
    })
  })

  test("ignores blank progress", async () => {
    const notificationService = mockDeepFn<NotificationServiceClient>()
    const reporter = createProgressReporter(notificationService, "notification-1", "Working")

    await reporter.report({ text: " \n " })
    await reporter.flush()

    expect(notificationService.updateNotification.spy()).not.toHaveBeenCalled()
  })
})
