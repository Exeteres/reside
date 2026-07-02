import type { Client } from "@temporalio/client"
import type { PrismaClient } from "../../database"
import { DEFAULT_TEMPORAL_TASK_QUEUE } from "@reside/common"
import { WorkflowIdReusePolicy } from "@temporalio/client"
import { OperationType } from "../../database"
import { getApprovalWorkflowId, TELEGRAM_APPROVAL_WORKFLOW_TYPE } from "../../definitions"
import { strings } from "../../locale"

const DEFAULT_APPROVAL_TITLE = strings.server.approval.defaultTitle

export async function createApprovalRequest(
  prisma: PrismaClient,
  temporalClient: Client,
  requesterSubjectId: string,
  title: string,
  content: string,
): Promise<{ operationId: number }> {
  const normalizedTitle = title.trim().length > 0 ? title : DEFAULT_APPROVAL_TITLE

  const created = await prisma.$transaction(async tx => {
    const operation = await tx.operation.create({
      data: {
        title: normalizedTitle,
        description: null,
        type: OperationType.APPROVAL_REQUEST,
      },
      select: {
        id: true,
      },
    })

    await tx.approvalRequest.create({
      data: {
        operationId: operation.id,
        title: normalizedTitle,
        content,
      },
    })

    return {
      operationId: operation.id,
    }
  })

  await temporalClient.workflow.start(TELEGRAM_APPROVAL_WORKFLOW_TYPE, {
    args: [
      {
        operationId: created.operationId,
        title: normalizedTitle,
        content,
        requesterSubjectId,
      },
    ],
    workflowId: getApprovalWorkflowId(created.operationId),
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
  })

  return {
    operationId: created.operationId,
  }
}
