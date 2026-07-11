import { describe, expect, test } from "bun:test"
import { Code, ConnectError } from "@connectrpc/connect"
import { throwNotificationServiceError, toApiNotification } from "./notification"

describe("toApiNotification", () => {
  test("accepts read models without optional protected subject", () => {
    const notification = toApiNotification({
      notificationId: "42",
      title: "Тест",
      content: "Сообщение",
      actionRows: [],
      taskGroups: [],
      requiresTextResponse: false,
      protected: false,
      expectImmediateFeedback: false,
      acquireTopic: false,
      acceptedDiceEmojis: [],
    })

    expect(notification.notificationId).toBe("42")
    expect(notification.protectedForSubjectId).toBeUndefined()
  })
})

describe("throwNotificationServiceError", () => {
  test("preserves connect error code and message", () => {
    const error = new ConnectError(
      "Planning notification tasks must be planned or skipped",
      Code.InvalidArgument,
    )
    let caughtError: unknown

    try {
      throwNotificationServiceError(error, "failed", "Failed")
    } catch (error) {
      caughtError = error
    }

    expect(caughtError).toBe(error)
    expect(caughtError).toBeInstanceOf(ConnectError)
    expect((caughtError as ConnectError).code).toBe(Code.InvalidArgument)
    expect((caughtError as ConnectError).rawMessage).toBe(
      "Planning notification tasks must be planned or skipped",
    )
  })

  test("wraps unknown failures as internal", () => {
    let caughtError: unknown

    try {
      throwNotificationServiceError(new Error("boom"), "failed", "Failed")
    } catch (error) {
      caughtError = error
    }

    expect(caughtError).toBeInstanceOf(ConnectError)
    expect((caughtError as ConnectError).code).toBe(Code.Internal)
    expect((caughtError as ConnectError).rawMessage).toBe("Failed")
  })
})
