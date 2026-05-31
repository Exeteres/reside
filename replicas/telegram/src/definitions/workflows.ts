import { defineSignal } from "@temporalio/workflow"

export const TELEGRAM_APPROVAL_WORKFLOW_TYPE = "handleApprovalRequestWorkflow"
export const TELEGRAM_AVATAR_PROVISION_WORKFLOW_TYPE = "ensureReplicaAvatarWorkflow"

export type AvatarManagedBotCreatedSignalInput = {
  managedBotId: string
  managedBotUsername: string
}

export type HandleApprovalRequestWorkflowInput = {
  operationId: number
  title: string
  content: string
  requesterSubjectId: string
}

export type EnsureReplicaAvatarWorkflowInput = {
  operationId: number
}

export const approvalCancelSignal = defineSignal("cancelApprovalRequest")

export const avatarManagedBotCreatedSignal =
  defineSignal<[AvatarManagedBotCreatedSignalInput]>("avatarManagedBotCreated")

export function getAvatarProvisionWorkflowId(operationId: number): string {
  return `avatar-provision-${operationId}`
}

export function getApprovalWorkflowId(operationId: number): string {
  return `approval-${operationId}`
}
