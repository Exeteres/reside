export const APPROVAL_WORKFLOW_TYPE = "handleSecurityApprovalWorkflow"

export type HandleSecurityApprovalWorkflowInput = {
  operationId: number
}

export function getApprovalWorkflowId(operationId: number): string {
  return `approval-${operationId}`
}
