import { describe, expect, test } from "bun:test"
import { NotificationTaskStatus } from "@reside/api/interaction/notification.v1"
import { buildTaskGroups } from "./reaper"

describe("buildTaskGroups", () => {
  test("uses planned status for initial planning notifications", () => {
    const groups = buildTaskGroups(
      [
        {
          id: "action-1",
          resourceReplicaName: "telegram",
          title: "Delete avatar",
          payload: "enc:reaper:payload",
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
