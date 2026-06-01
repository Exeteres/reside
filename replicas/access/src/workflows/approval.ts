import type { ApprovalResponseJson } from "@reside/api/common/approval.v1"
import type { AccessActivities, ApprovePermissionRequestSetWorkflowInput } from "../definitions"
import { waitForOperationResult } from "@reside/common/workflow"
import { isCancellation, log, proxyActivities } from "@temporalio/workflow"
import { strings } from "../locale"

const {
  getApprovalContext,
  subscribeToExternalOperationCompletion,
  cancelApproverOperation,
  approvePermissionRequestSet,
  rejectPermissionRequestSet,
  notifyApprovedPermissionRequestSet,
  failPermissionRequestSetWorkflowIfPending,
} = proxyActivities<AccessActivities>({
  scheduleToCloseTimeout: "5 minutes",
})

const { requestApproverDecision } = proxyActivities<
  Pick<AccessActivities, "requestApproverDecision">
>({
  scheduleToCloseTimeout: "5 minutes",
  // This activity creates an external approval operation, so retries can duplicate notifications.
  retry: {
    maximumAttempts: 1,
  },
})

export async function approvePermissionRequestSetWorkflow({
  operationId,
}: ApprovePermissionRequestSetWorkflowInput): Promise<void> {
  log.info("starting approvePermissionRequestSetWorkflow", { operationId })

  let currentApproverOperation:
    | {
        approverId: number
        operationId: number
      }
    | undefined

  try {
    const approvalContext = await getApprovalContext({ operationId })
    const approvers = approvalContext.approvers

    log.info("loaded approval context", { operationId, approversCount: approvers.length })

    for (const approver of approvers) {
      log.info("requesting approver decision", { operationId, approverName: approver.name })

      const { operationId: approverOperationId } = await requestApproverDecision({
        approverId: approver.id,
        title: approvalContext.title,
        content: approvalContext.content,
      })

      currentApproverOperation = {
        approverId: approver.id,
        operationId: approverOperationId,
      }

      log.info("waiting for approver operation result", {
        operationId,
        approverOperationId,
        approverName: approver.name,
      })

      const approvalResponse = await waitForOperationResult<ApprovalResponseJson>(
        approverOperationId,
        async (waitOperationId, workflowId) => {
          return await subscribeToExternalOperationCompletion({
            approverId: approver.id,
            operationId: waitOperationId,
            workflowId,
          })
        },
      )

      currentApproverOperation = undefined

      if (approvalResponse.result === "ESCALATED") {
        log.info("approver escalated request", { operationId, approverName: approver.name })
        continue
      }

      if (approvalResponse.result === "APPROVED") {
        log.info("approver approved request", { operationId, approverName: approver.name })

        await approvePermissionRequestSet({
          operationId,
          resolution: approvalResponse.resolution ?? "",
          resolvedBySubjectId: null,
        })

        await notifyApprovedPermissionRequestSet({
          requestSetId: approvalContext.requestSetId,
          approverName: approver.name,
          approverTitle: approver.title,
          resolution: approvalResponse.resolution ?? "",
        })

        log.info("processed approved request notification", {
          operationId,
          requestSetId: approvalContext.requestSetId,
          approverName: approver.name,
        })
        return
      }

      log.info("approver rejected request", { operationId, approverName: approver.name })

      await rejectPermissionRequestSet({
        operationId,
        resolution: approvalResponse.resolution ?? "",
        resolvedBySubjectId: null,
      })
      return
    }

    log.info("no approver approved request, marking as rejected")

    await rejectPermissionRequestSet({
      operationId,
      resolution: strings.common.noApproverApproved,
      resolvedBySubjectId: null,
    })
  } catch (error) {
    if (isCancellation(error)) {
      log.info("approval workflow cancelled", { operationId })

      if (currentApproverOperation !== undefined) {
        log.info("cancelling active approver operation", {
          operationId,
          approverId: currentApproverOperation.approverId,
          approverOperationId: currentApproverOperation.operationId,
        })
        await cancelApproverOperation(currentApproverOperation)
      }

      return
    }

    log.error("approval workflow failed, marking operation as failed", { operationId })

    await failPermissionRequestSetWorkflowIfPending({
      operationId,
      resolution: strings.common.approvalWorkflowFailed,
    })

    log.info("marked approval operation as failed", { operationId })

    return
  }
}
