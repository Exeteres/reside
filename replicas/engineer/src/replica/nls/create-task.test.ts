import type { Client as TemporalClient } from "@temporalio/client"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { DEFAULT_TEMPORAL_TASK_QUEUE } from "@reside/common"
import { createCreateTaskTool } from "./create-task"

const previousReplicaName = process.env.REPLICA_NAME

beforeAll(() => {
  process.env.REPLICA_NAME = "engineer"
})

afterAll(() => {
  if (previousReplicaName === undefined) {
    delete process.env.REPLICA_NAME
    return
  }

  process.env.REPLICA_NAME = previousReplicaName
})

describe("createCreateTaskTool", () => {
  test("prepares task and starts task workflow", async () => {
    const startCalls: Array<{ workflowType: string; options: unknown }> = []
    const temporalClient = createTemporalClient({
      start: async (workflowType, options) => {
        startCalls.push({ workflowType, options })

        return {
          result: async () => ({
            topicId: "topic-1",
            notificationId: "notification-1",
            messageLink: "https://example.test/task/1",
            previewTitle: "Деплой",
          }),
        }
      },
    })

    const tool = createCreateTaskTool({ temporalClient })
    const result = await tool.handler(
      { task: "  fix deploy  ", mode: "plan" },
      {} as Parameters<typeof tool.handler>[1],
    )

    expect(result).toMatchObject({
      status: "created",
      messageLink: "https://example.test/task/1",
    })
    expect(startCalls).toHaveLength(2)
    expect(startCalls[0]).toMatchObject({
      workflowType: "prepareTaskWorkflow",
      options: {
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        args: [
          {
            prompt: "fix deploy",
            mode: "plan",
            subjectId: "replica:engineer",
          },
        ],
      },
    })
    expect(startCalls[1]).toMatchObject({
      workflowType: "taskWorkflow",
      options: {
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        args: [
          {
            prompt: "fix deploy",
            mode: "plan",
            subjectId: "replica:engineer",
            topicId: "topic-1",
            notificationId: "notification-1",
          },
        ],
      },
    })
  })

  test("throws when workflow start fails", async () => {
    const temporalClient = createTemporalClient({
      start: async () => {
        throw new Error("temporal unavailable")
      },
    })

    const tool = createCreateTaskTool({ temporalClient })
    await expect(
      tool.handler({ task: "fix deploy", mode: "plan" }, {} as Parameters<typeof tool.handler>[1]),
    ).rejects.toThrow("temporal unavailable")
  })

  test("throws for blank task", async () => {
    const temporalClient = createTemporalClient({
      start: async () => {
        throw new Error("must not be called")
      },
    })

    const tool = createCreateTaskTool({ temporalClient })
    await expect(
      tool.handler({ task: " ", mode: "plan" }, {} as Parameters<typeof tool.handler>[1]),
    ).rejects.toThrow("Task description must not be empty")
  })
})

function createTemporalClient(args: {
  start: (workflowType: string, options: unknown) => Promise<unknown>
}): TemporalClient {
  return {
    workflow: {
      start: async (workflowType: string, options: unknown) =>
        await args.start(workflowType, options),
    },
  } as TemporalClient
}
