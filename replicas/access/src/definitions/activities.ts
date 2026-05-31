import type { SubscribeToOperationCompletionResponseJson } from "@reside/api/common/operation.v1"

export type ApprovalContextApprover = {
  id: number
  name: string
  priority: number
  realms: string[]
}

export type ApprovalContext = {
  requestSetId: number
  operationId: number
  subjectId: string
  title: string
  content: string
  approvers: ApprovalContextApprover[]
}

export type GetApprovalContextInput = {
  /**
   * The permission request operation identifier.
   */
  operationId: number
}

export type RequestApproverDecisionInput = {
  /**
   * The approver identifier.
   */
  approverId: number

  /**
   * The approval request title.
   */
  title: string

  /**
   * The approval request content.
   */
  content: string
}

export type RequestApproverDecisionOutput = {
  /**
   * The created approver operation identifier.
   */
  operationId: number
}

export type SubscribeToExternalOperationCompletionInput = {
  /**
   * The approver identifier.
   */
  approverId: number

  /**
   * The external operation identifier.
   */
  operationId: number

  /**
   * The waiting workflow identifier.
   */
  workflowId: string
}

export type CancelApproverOperationInput = {
  /**
   * The approver identifier.
   */
  approverId: number

  /**
   * The approver operation identifier.
   */
  operationId: number
}

export type ResolvePermissionRequestSetInput = {
  /**
   * The permission request operation identifier.
   */
  operationId: number

  /**
   * The resolution message.
   */
  resolution: string

  /**
   * The subject that resolved the request set.
   */
  resolvedBySubjectId: string | null
}

export type FailPermissionRequestSetWorkflowIfPendingInput = {
  /**
   * The permission request operation identifier.
   */
  operationId: number

  /**
   * The failure reason text.
   */
  resolution: string
}

export type AccessActivities = {
  /**
   * Loads approval context for a permission request operation.
   */
  getApprovalContext: (input: GetApprovalContextInput) => Promise<ApprovalContext>

  /**
   * Requests a decision from an approver.
   */
  requestApproverDecision: (
    input: RequestApproverDecisionInput,
  ) => Promise<RequestApproverDecisionOutput>

  /**
   * Subscribes to completion updates for an external operation.
   */
  subscribeToExternalOperationCompletion: (
    input: SubscribeToExternalOperationCompletionInput,
  ) => Promise<SubscribeToOperationCompletionResponseJson>

  /**
   * Cancels an approver operation.
   */
  cancelApproverOperation: (input: CancelApproverOperationInput) => Promise<void>

  /**
   * Approves a permission request set.
   */
  approvePermissionRequestSet: (input: ResolvePermissionRequestSetInput) => Promise<void>

  /**
   * Rejects a permission request set.
   */
  rejectPermissionRequestSet: (input: ResolvePermissionRequestSetInput) => Promise<void>

  /**
   * Fails an approval workflow when the operation is still pending.
   */
  failPermissionRequestSetWorkflowIfPending: (
    input: FailPermissionRequestSetWorkflowIfPendingInput,
  ) => Promise<void>
}
