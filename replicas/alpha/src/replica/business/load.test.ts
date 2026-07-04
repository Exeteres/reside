import type { Client } from "@temporalio/client"
import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { ConnectError } from "@connectrpc/connect"
import { mockDeepFn } from "@reside/common/testing"
import {
  assertRequiredValue,
  startReplicaReadinessWorkflow,
  upsertLoadedReplicaAndCreateOperation,
} from "./load"

describe("assertRequiredValue", () => {
  test("throws for empty values", () => {
    expect(() => assertRequiredValue("", "name")).toThrow('Field "name" is required')
  })

  test("accepts non-empty values", () => {
    expect(() => assertRequiredValue("alpha", "name")).not.toThrow()
  })
})

describe("startReplicaReadinessWorkflow", () => {
  test("wraps regular errors into connect internal error", async () => {
    const temporalClient = mockDeepFn<Client>()
    temporalClient.workflow.start.mockRejectedValue(new Error("boom"))

    const promise = startReplicaReadinessWorkflow(temporalClient, 10)

    expect(promise).rejects.toBeInstanceOf(ConnectError)
    expect(promise).rejects.toThrow("boom")
  })

  test("throws generic internal error for unknown throw type", async () => {
    const temporalClient = mockDeepFn<Client>()
    temporalClient.workflow.start.mockRejectedValue("boom" as never)

    expect(startReplicaReadinessWorkflow(temporalClient, 10)).rejects.toThrow(
      "Failed to schedule replica readiness workflow",
    )
  })
})

describe("upsertLoadedReplicaAndCreateOperation", () => {
  test("upserts replica, creates operation and starts workflow", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const temporalClient = mockDeepFn<Client>()

    prisma.operation.create.mockResolvedValue({ id: 42 } as never)
    temporalClient.workflow.start.mockResolvedValue({} as never)

    const operation = await upsertLoadedReplicaAndCreateOperation({
      prisma,
      temporalClient,
      name: "alpha",
      image: "ghcr.io/example/alpha:1",
    })

    expect(prisma.replica.upsert.spy()).toHaveBeenCalledTimes(1)
    expect(prisma.operation.create.spy()).toHaveBeenCalledTimes(1)
    expect(temporalClient.workflow.start.spy()).toHaveBeenCalledWith(
      "waitForReplicaRegistrationWorkflow",
      expect.objectContaining({
        args: [{ operationId: 42 }],
        workflowId: "wait-replica-ready-42",
      }),
    )
    expect(operation.id).toBe(42)
  })
})
