import type { SecurityActivities } from "../definitions"
import type { HandleSecurityApprovalWorkflowInput } from "../definitions/workflows"
import { isCancellation, proxyActivities } from "@temporalio/workflow"

const { judgeApprovalRequest, applyApprovalDecision, failApprovalOperation } =
  proxyActivities<SecurityActivities>({
    scheduleToCloseTimeout: "10 minutes",
  })

export async function handleSecurityApprovalWorkflow({
  operationId,
}: HandleSecurityApprovalWorkflowInput): Promise<void> {
  try {
    const decision = await judgeApprovalRequest({ operationId })

    await applyApprovalDecision({
      operationId,
      result: decision.result,
      resolution: decision.resolution,
    })
  } catch (error) {
    if (isCancellation(error)) {
      return
    }

    const message = error instanceof Error ? error.message : String(error)

    await failApprovalOperation({
      operationId,
      message,
    })
  }
}
