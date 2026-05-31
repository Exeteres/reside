import type { Client } from "@temporalio/client"
import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { mockDeepFn } from "@reside/common/testing"
import { TELEGRAM_AVATAR_PROVISION_WORKFLOW_TYPE } from "../../definitions"
import { ensureAvatarProvision } from "./avatar"

type TransactionPrisma = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$extends" | "$on" | "$transaction"
>

describe("ensureAvatarProvision", () => {
  test("returns undefined operation when avatar already exists", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const temporalClient = mockDeepFn<Client>()
    temporalClient.workflow.start.mockResolvedValue({ workflowId: "mock-workflow-id" } as never)
    prisma.avatar.findUnique.mockResolvedValue({ id: 1 } as never)

    const outcome = await ensureAvatarProvision(
      prisma,
      temporalClient,
      "replica:demo",
      "demo",
      "Demo",
    )

    expect(outcome.operationId).toBeUndefined()
    expect(prisma.avatar.findUnique.spy()).toHaveBeenCalledTimes(1)
    expect(prisma.avatarProvisionRequest.findFirst.spy()).toHaveBeenCalledTimes(0)
    expect(prisma.operation.create.spy()).toHaveBeenCalledTimes(0)
    expect(prisma.avatarProvisionRequest.create.spy()).toHaveBeenCalledTimes(0)
    expect(temporalClient.workflow.start.spy()).toHaveBeenCalledTimes(0)
  })

  test("reuses pending provision operation when present", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const temporalClient = mockDeepFn<Client>()
    temporalClient.workflow.start.mockResolvedValue({ workflowId: "mock-workflow-id" } as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)
    prisma.avatarProvisionRequest.findFirst.mockResolvedValue({ operationId: 42 } as never)

    const outcome = await ensureAvatarProvision(
      prisma,
      temporalClient,
      "replica:demo",
      "demo",
      "Demo",
    )

    expect(outcome.operationId).toBe(42)
    expect(prisma.avatar.findUnique.spy()).toHaveBeenCalledTimes(1)
    expect(prisma.avatarProvisionRequest.findFirst.spy()).toHaveBeenCalledTimes(1)
    expect(prisma.operation.create.spy()).toHaveBeenCalledTimes(0)
    expect(prisma.avatarProvisionRequest.create.spy()).toHaveBeenCalledTimes(0)
    expect(temporalClient.workflow.start.spy()).toHaveBeenCalledTimes(0)
  })

  test("creates and starts workflow when no avatar and no pending operation", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const temporalClient = mockDeepFn<Client>()
    temporalClient.workflow.start.mockResolvedValue({ workflowId: "mock-workflow-id" } as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)
    prisma.avatarProvisionRequest.findFirst.mockResolvedValue(null as never)
    prisma.operation.create.mockResolvedValue({ id: 99 } as never)
    prisma.avatarProvisionRequest.create.mockResolvedValue({ operationId: 99 } as never)
    prisma.$transaction.mockImplementation(
      async (callback: (tx: TransactionPrisma) => Promise<unknown>) => {
        return await callback(prisma as unknown as TransactionPrisma)
      },
    )

    const outcome = await ensureAvatarProvision(
      prisma,
      temporalClient,
      "replica:demo",
      "demo",
      "Demo",
    )

    expect(outcome.operationId).toBe(99)
    expect(prisma.operation.create.spy()).toHaveBeenCalledTimes(1)
    expect(prisma.avatarProvisionRequest.create.spy()).toHaveBeenCalledTimes(1)

    expect(prisma.operation.create.spy()).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: expect.any(String),
          description: expect.any(String),
        }),
      }),
    )
    expect(prisma.avatarProvisionRequest.create.spy()).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          operationId: 99,
          subjectId: "replica:demo",
          replicaName: "demo",
          replicaTitle: "Demo",
          expectedPrefix: "reside_demo",
        }),
      }),
    )

    expect(temporalClient.workflow.start.spy()).toHaveBeenCalledTimes(1)
    expect(temporalClient.workflow.start.spy()).toHaveBeenCalledWith(
      TELEGRAM_AVATAR_PROVISION_WORKFLOW_TYPE,
      expect.objectContaining({
        args: [
          {
            operationId: outcome.operationId,
          },
        ],
      }),
    )
  })
})
