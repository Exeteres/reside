import type { ApprovalResultJson } from "@reside/api/common/approval.v1"

export type JudgeApprovalRequestInput = {
  /**
   * The operation identifier of the approval request.
   */
  operationId: number
}

export type JudgeApprovalRequestOutput = {
  /**
   * The decision produced by the language agent.
   */
  result: Extract<ApprovalResultJson, "APPROVED" | "ESCALATED">

  /**
   * Human-readable resolution message.
   */
  resolution: string
}

export type ApplyApprovalDecisionInput = {
  /**
   * The operation identifier of the approval request.
   */
  operationId: number

  /**
   * The decision produced by the language agent.
   */
  result: Extract<ApprovalResultJson, "APPROVED" | "ESCALATED">

  /**
   * Human-readable resolution message.
   */
  resolution: string
}

export type FailApprovalOperationInput = {
  /**
   * The operation identifier of the approval request.
   */
  operationId: number

  /**
   * The failure message to persist.
   */
  message: string
}

export type SecurityActivities = {
  /**
   * Runs language judgement for the approval request.
   */
  judgeApprovalRequest: (input: JudgeApprovalRequestInput) => Promise<JudgeApprovalRequestOutput>

  /**
   * Persists the approval decision and completes the operation.
   */
  applyApprovalDecision: (input: ApplyApprovalDecisionInput) => Promise<void>

  /**
   * Marks approval operation as failed.
   */
  failApprovalOperation: (input: FailApprovalOperationInput) => Promise<void>
}
