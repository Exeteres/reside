import type { ApprovalResponseJson } from "@reside/api/common/approval.v1"
import type { SubscribeToOperationCompletionResponseJson } from "@reside/api/common/operation.v1"
import { deliverOperationCompletionWorkflow, waitForOperationResult } from "@reside/common/workflow"
import { isCancellation, log, proxyActivities } from "@temporalio/workflow"
import { strings } from "../locale"

const {
  getApprovalContext,
  subscribeToExternalOperationCompletion,
  cancelApproverOperation,
  approvePermissionRequestSet,
  rejectPermissionRequestSet,
  failPermissionRequestSetWorkflowIfPending,
} = proxyActivities<{
  getApprovalContext: (operationId: number) => Promise<{
    title: string
    content: string
    approvers: Array<{
      id: number
      name: string
    }>
  }>
  requestApproverDecision: (input: {
    approverId: number
    title: string
    content: string
  }) => Promise<number>
  subscribeToExternalOperationCompletion: (input: {
    approverId: number
    operationId: number
    workflowId: string
  }) => Promise<SubscribeToOperationCompletionResponseJson>
  cancelApproverOperation: (input: { approverId: number; operationId: number }) => Promise<void>
  approvePermissionRequestSet: (input: {
    operationId: number
    resolution: string
    resolvedBySubjectId: string | null
  }) => Promise<void>
  rejectPermissionRequestSet: (input: {
    operationId: number
    resolution: string
    resolvedBySubjectId: string | null
  }) => Promise<void>
  failPermissionRequestSetWorkflowIfPending: (input: {
    operationId: number
    resolution: string
  }) => Promise<void>
}>({
  scheduleToCloseTimeout: "5 minutes",
})

const { requestApproverDecision } = proxyActivities<{
  requestApproverDecision: (input: {
    approverId: number
    title: string
    content: string
  }) => Promise<number>
}>({
  scheduleToCloseTimeout: "5 minutes",
  // This activity creates an external approval operation, so retries can duplicate notifications.
  retry: {
    maximumAttempts: 1,
  },
})

export { deliverOperationCompletionWorkflow }

export async function approvePermissionRequestSetWorkflow(operationId: number): Promise<void> {
  log.info("starting approvePermissionRequestSetWorkflow", { operationId })

  let currentApproverOperation:
    | {
        approverId: number
        operationId: number
      }
    | undefined

  try {
    const approvalContext = await getApprovalContext(operationId)
    const approvers = approvalContext.approvers

    log.info("loaded approval context", { operationId, approversCount: approvers.length })

    for (const approver of approvers) {
      log.info("requesting approver decision", { operationId, approverName: approver.name })

      const approverOperationId = await requestApproverDecision({
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
      if (currentApproverOperation !== undefined) {
        await cancelApproverOperation(currentApproverOperation)
      }

      return
    }

    await failPermissionRequestSetWorkflowIfPending({
      operationId,
      resolution: strings.common.approvalWorkflowFailed,
    })

    return
  }
}
