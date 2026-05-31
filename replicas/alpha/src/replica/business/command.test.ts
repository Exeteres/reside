import type { Client as TemporalClient } from "@temporalio/client"
import { describe, expect, test } from "bun:test"
import { mockDeepFn } from "@reside/common/testing"
import { startResetReplicaNodeCommand, startSetReplicaNodeCommand } from "./command"

describe("startSetReplicaNodeCommand", () => {
  test("starts command workflow with set-replica-node payload", async () => {
    const temporalClient = mockDeepFn<TemporalClient>()

    await startSetReplicaNodeCommand(temporalClient, "inv-1", "replica:alpha", "alpha", "node-a")

    expect(temporalClient.workflow.start.spy()).toHaveBeenCalledWith(
      "handleCommandWorkflow",
      expect.objectContaining({
        workflowId: "handle-command-inv-1",
      }),
    )
  })
})

describe("startResetReplicaNodeCommand", () => {
  test("starts command workflow with reset-replica-node payload", async () => {
    const temporalClient = mockDeepFn<TemporalClient>()

    await startResetReplicaNodeCommand(temporalClient, "inv-2", "replica:alpha", "alpha")

    expect(temporalClient.workflow.start.spy()).toHaveBeenCalledWith(
      "handleCommandWorkflow",
      expect.objectContaining({
        workflowId: "handle-command-inv-2",
      }),
    )
  })
})
