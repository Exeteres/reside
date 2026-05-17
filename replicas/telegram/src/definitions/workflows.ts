export const TELEGRAM_APPROVAL_WORKFLOW_TYPE = "handleApprovalRequestWorkflow"
export const TELEGRAM_APPROVAL_CANCEL_SIGNAL = "cancelApprovalRequest"
export const TELEGRAM_AVATAR_PROVISION_WORKFLOW_TYPE = "ensureReplicaAvatarWorkflow"

export function getTelegramAvatarProvisionWorkflowId(operationId: number): string {
  return `telegram-avatar-provision-${operationId}`
}

export function getTelegramApprovalWorkflowId(operationId: number): string {
  return `telegram-approval-${operationId}`
}
