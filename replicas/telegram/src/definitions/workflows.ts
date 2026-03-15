export const TELEGRAM_APPROVAL_WORKFLOW_TYPE = "handleApprovalRequestWorkflow"
export const TELEGRAM_APPROVAL_CANCEL_SIGNAL = "cancelApprovalRequest"

export function getTelegramApprovalWorkflowId(operationId: number): string {
  return `telegram-approval-${operationId}`
}
