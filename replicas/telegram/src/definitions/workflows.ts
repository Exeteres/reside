import { defineSignal } from "@temporalio/workflow"

export const TELEGRAM_APPROVAL_WORKFLOW_TYPE = "handleApprovalRequestWorkflow"
export const TELEGRAM_AVATAR_PROVISION_WORKFLOW_TYPE = "ensureReplicaAvatarWorkflow"
export const TELEGRAM_DELETE_AVATAR_WORKFLOW_TYPE = "deleteAvatarWorkflow"
export const TELEGRAM_ACTIVITY_REWARD_WORKFLOW_TYPE = "rewardActivityWorkflow"
export const TELEGRAM_ACTIVITY_REWARD_WORKFLOW_ID = "activity-reward"

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

export type DeleteAvatarWorkflowInput = {
  operationId: number
  avatarId: number | null
  replicaName: string
  avatarProvisionRequestIds: number[]
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
