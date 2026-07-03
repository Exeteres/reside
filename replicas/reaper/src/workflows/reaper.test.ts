import type { OperationJson } from "@reside/api/common/operation.v1"
import { describe, expect, test } from "bun:test"
import { NotificationTaskStatus } from "@reside/api/interaction/notification.v1"
import {
  applyActionHintSelectionRules,
  applyResourceOperationPollResult,
  buildTaskGroups,
} from "./reaper"

type TestTrackedAction = {
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "SKIPPED"
  operation?: OperationJson
}

describe("buildTaskGroups", () => {
  test("uses planned status for initial planning notifications", () => {
    const groups = buildTaskGroups(
      [
        {
          id: "action-1",
          resourceReplicaName: "telegram",
          title: "Delete avatar",
          payload: "enc:reaper:payload",
          hints: [],
          handler: {
            resourceReplicaName: "telegram",
            title: "Telegram",
            callbackEndpoint: "telegram.replica-telegram.svc.cluster.local:80",
          },
        },
      ],
      "PLANNED",
    )

    expect(groups).toEqual([
      {
        id: "telegram",
        title: "Telegram",
        tasks: [
          {
            id: "action-1",
            title: "Delete avatar",
            status: NotificationTaskStatus.PLANNED,
          },
        ],
      },
    ])
  })
})

describe("applyActionHintSelectionRules", () => {
  test("skips existence actions when a critical action is skipped", () => {
    const actions = [
      {
        id: "delete-avatar",
        resourceReplicaName: "telegram",
        title: "Delete avatar",
        payload: "enc:telegram:payload",
        hints: ["REAPER_ACTION_HINT_CRITICAL" as const],
        status: "SKIPPED" as const,
        handler: {
          resourceReplicaName: "telegram",
          title: "Telegram",
          callbackEndpoint: "telegram.replica-telegram.svc.cluster.local:80",
        },
      },
      {
        id: "unregister-replica",
        resourceReplicaName: "alpha",
        title: "Unregister replica",
        payload: "enc:alpha:payload",
        hints: ["REAPER_ACTION_HINT_EXISTENCE" as const],
        status: "PENDING" as const,
        handler: {
          resourceReplicaName: "alpha",
          title: "Alpha",
          callbackEndpoint: "alpha.replica-alpha.svc.cluster.local:80",
        },
      },
    ]

    applyActionHintSelectionRules(actions)

    expect(actions[1]!.status).toBe("SKIPPED")
  })

  test("keeps existence actions when only a non-critical action is skipped", () => {
    const actions = [
      {
        id: "delete-avatar",
        resourceReplicaName: "telegram",
        title: "Delete avatar",
        payload: "enc:telegram:payload",
        hints: [],
        status: "SKIPPED" as const,
        handler: {
          resourceReplicaName: "telegram",
          title: "Telegram",
          callbackEndpoint: "telegram.replica-telegram.svc.cluster.local:80",
        },
      },
      {
        id: "delete-database",
        resourceReplicaName: "infra",
        title: "Delete database",
        payload: "enc:infra:payload",
        hints: ["REAPER_ACTION_HINT_CRITICAL" as const],
        status: "PENDING" as const,
        handler: {
          resourceReplicaName: "infra",
          title: "Infra",
          callbackEndpoint: "infra.replica-infra.svc.cluster.local:80",
        },
      },
      {
        id: "unregister-replica",
        resourceReplicaName: "alpha",
        title: "Unregister replica",
        payload: "enc:alpha:payload",
        hints: ["REAPER_ACTION_HINT_EXISTENCE" as const],
        status: "PENDING" as const,
        handler: {
          resourceReplicaName: "alpha",
          title: "Alpha",
          callbackEndpoint: "alpha.replica-alpha.svc.cluster.local:80",
        },
      },
    ]

    applyActionHintSelectionRules(actions)

    expect(actions[1]!.status).toBe("PENDING")
  })
})

describe("applyResourceOperationPollResult", () => {
  test("marks action failed when resource operation is missing", () => {
    const action: TestTrackedAction = {
      status: "IN_PROGRESS",
      operation: {
        id: 30,
        status: "OPERATION_STATUS_IN_PROGRESS",
      },
    }

    applyResourceOperationPollResult(action, { found: false })

    expect(action.status).toBe("FAILED")
    expect(action.operation?.id).toBe(30)
  })

  test("updates action from available resource operation", () => {
    const action: TestTrackedAction = {
      status: "IN_PROGRESS",
      operation: {
        id: 30,
        status: "OPERATION_STATUS_IN_PROGRESS",
      },
    }
    const operation: OperationJson = {
      id: 30,
      status: "OPERATION_STATUS_COMPLETED",
    }

    applyResourceOperationPollResult(action, { found: true, operation })

    expect(action.status).toBe("COMPLETED")
    expect(action.operation).toBe(operation)
  })
})
