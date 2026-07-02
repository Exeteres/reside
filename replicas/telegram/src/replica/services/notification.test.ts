import { describe, expect, test } from "bun:test"
import { Code, ConnectError } from "@connectrpc/connect"
import { NotificationTaskStatus } from "@reside/api/interaction/notification.v1"
import { throwNotificationServiceError, toBusinessTaskGroup } from "./notification"

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

describe("toBusinessTaskGroup", () => {
  test("normalizes pending tasks to planned for planning notifications", () => {
    expect(
      toBusinessTaskGroup(
        {
          id: "group-1",
          title: "Group",
          tasks: [
            {
              id: "task-1",
              title: "Task",
              status: NotificationTaskStatus.PENDING,
            },
          ],
        },
        "PLANNING",
      ),
    ).toEqual({
      id: "group-1",
      title: "Group",
      tasks: [
        {
          id: "task-1",
          title: "Task",
          status: "PLANNED",
        },
      ],
    })
  })

  test("keeps pending tasks outside planning notifications", () => {
    expect(
      toBusinessTaskGroup(
        {
          id: "group-1",
          title: "Group",
          tasks: [
            {
              id: "task-1",
              title: "Task",
              status: NotificationTaskStatus.PENDING,
            },
          ],
        },
        "IN_PROGRESS",
      ).tasks[0]?.status,
    ).toBe("PENDING")
  })
})
