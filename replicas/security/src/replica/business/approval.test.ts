import type { Client } from "@temporalio/client"
import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { DEFAULT_TEMPORAL_TASK_QUEUE } from "@reside/common"
import { mockDeepFn } from "@reside/common/testing"
import { WorkflowIdReusePolicy } from "@temporalio/client"
import { APPROVAL_WORKFLOW_TYPE } from "../../definitions"
import { strings } from "../../locale"
import { createApprovalRequest } from "./approval"

describe("createApprovalRequest", () => {
  test("creates operation/request with normalized payload and starts workflow", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const temporalClient = mockDeepFn<Client>()
    const tx = mockDeepFn<PrismaClient>()

    prisma.$transaction.mockImplementation(async callback => await callback(tx as never))
    tx.operation.create.mockResolvedValue({ id: 101 } as never)
    tx.approvalRequest.create.mockResolvedValue({ operationId: 101 } as never)

    const result = await createApprovalRequest(
      prisma,
      temporalClient,
      "  Need Access  ",
      "  body  ",
    )

    expect(result).toEqual({
      operationId: 101,
    })
    expect(tx.operation.create.spy()).toHaveBeenCalledWith({
      data: {
        title: "Need Access",
        description: null,
      },
      select: {
        id: true,
      },
    })
    expect(tx.approvalRequest.create.spy()).toHaveBeenCalledWith({
      data: {
        operationId: 101,
        title: "Need Access",
        content: "body",
      },
    })
    expect(temporalClient.workflow.start.spy()).toHaveBeenCalledWith(APPROVAL_WORKFLOW_TYPE, {
      args: [
        {
          operationId: 101,
        },
      ],
      workflowId: "approval-101",
      taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
    })
  })

  test("uses default title when incoming title is blank", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const temporalClient = mockDeepFn<Client>()
    const tx = mockDeepFn<PrismaClient>()

    prisma.$transaction.mockImplementation(async callback => await callback(tx as never))
    tx.operation.create.mockResolvedValue({ id: 77 } as never)
    tx.approvalRequest.create.mockResolvedValue({ operationId: 77 } as never)

    await createApprovalRequest(prisma, temporalClient, "   ", "  content  ")

    expect(tx.operation.create.spy()).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: strings.server.approval.defaultTitle,
        }),
      }),
    )
    expect(tx.approvalRequest.create.spy()).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: strings.server.approval.defaultTitle,
          content: "content",
        }),
      }),
    )
  })
})
