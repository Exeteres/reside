import type { Client } from "@temporalio/client"
import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { mockDeepFn } from "@reside/common/testing"
import { TELEGRAM_APPROVAL_WORKFLOW_TYPE } from "../../definitions"
import { createApprovalRequest } from "./approval"

type TransactionPrisma = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$extends" | "$on" | "$transaction"
>

describe("createApprovalRequest", () => {
  test("uses default title when title is blank", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const temporalClient = mockDeepFn<Client>()
    temporalClient.workflow.start.mockResolvedValue({ workflowId: "mock-workflow-id" } as never)

    prisma.operation.create.mockResolvedValue({ id: 101 } as never)
    prisma.approvalRequest.create.mockResolvedValue({ operationId: 101 } as never)
    prisma.$transaction.mockImplementation(
      async (callback: (tx: TransactionPrisma) => Promise<unknown>) => {
        return await callback(prisma as unknown as TransactionPrisma)
      },
    )

    const result = await createApprovalRequest(
      prisma,
      temporalClient,
      "telegram:42",
      "   ",
      "content",
    )
    expect(result.operationId).toBe(101)
    expect(prisma.operation.create.spy()).toHaveBeenCalledTimes(1)
    expect(prisma.approvalRequest.create.spy()).toHaveBeenCalledTimes(1)

    expect(prisma.operation.create.spy()).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: expect.any(String),
          description: null,
        }),
      }),
    )
    expect(prisma.approvalRequest.create.spy()).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          operationId: 101,
          title: expect.any(String),
          content: "content",
        }),
      }),
    )

    expect(temporalClient.workflow.start.spy()).toHaveBeenCalledTimes(1)
    expect(temporalClient.workflow.start.spy()).toHaveBeenCalledWith(
      TELEGRAM_APPROVAL_WORKFLOW_TYPE,
      expect.objectContaining({
        args: [
          {
            operationId: result.operationId,
            title: expect.any(String),
            content: "content",
            requesterSubjectId: "telegram:42",
          },
        ],
      }),
    )
  })
})
