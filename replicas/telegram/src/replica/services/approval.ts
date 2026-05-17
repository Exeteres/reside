import type { HandlerContext } from "@connectrpc/connect"
import type { ApprovalRequest, ApprovalServiceImplementation } from "@reside/api/common/approval.v1"
import type { Operation as ApiOperation } from "@reside/api/common/operation.v1"
import type { GenericOperationService } from "@reside/common"
import type { Client } from "@temporalio/client"
import type { Operation, PrismaClient } from "../../database"
import { authenticate, DEFAULT_TEMPORAL_TASK_QUEUE, logger } from "@reside/common"
import { WorkflowIdReusePolicy } from "@temporalio/client"
import { getTelegramApprovalWorkflowId, TELEGRAM_APPROVAL_WORKFLOW_TYPE } from "../../definitions"
import { strings } from "../../locale"

const DEFAULT_APPROVAL_TITLE = strings.server.approval.defaultTitle

export function createApprovalService({
  prisma,
  operationService,
  temporalClient,
}: {
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
  temporalClient: Client
}): ApprovalServiceImplementation {
  return {
    async approve(request: ApprovalRequest, context: HandlerContext): Promise<ApiOperation> {
      const { subjectId } = await authenticate(context)

      logger.info("creating telegram approval request workflow")

      const approvalRequest = await prisma.$transaction(async tx => {
        const operation = await tx.operation.create({
          data: {
            title: request.title.trim().length > 0 ? request.title : DEFAULT_APPROVAL_TITLE,
            description: null,
          },
          select: {
            id: true,
          },
        })

        return await tx.approvalRequest.create({
          data: {
            operationId: operation.id,
            title: request.title.trim().length > 0 ? request.title : DEFAULT_APPROVAL_TITLE,
            content: request.content,
          },
          select: {
            operationId: true,
            title: true,
            content: true,
          },
        })
      })

      await temporalClient.workflow.start(TELEGRAM_APPROVAL_WORKFLOW_TYPE, {
        args: [
          {
            operationId: approvalRequest.operationId,
            title: approvalRequest.title,
            content: approvalRequest.content,
            requesterSubjectId: subjectId,
          },
        ],
        workflowId: getTelegramApprovalWorkflowId(approvalRequest.operationId),
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
      })

      logger.info(
        "started telegram approval workflow for operationId %d",
        approvalRequest.operationId,
      )

      return await operationService.toApiOperation(approvalRequest.operationId)
    },
  }
}
