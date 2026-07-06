import { defineSignal } from "@temporalio/workflow"

export const TELEGRAM_AVATAR_PROVISION_WORKFLOW_TYPE = "ensureReplicaAvatarWorkflow"
export const TELEGRAM_DELETE_AVATAR_WORKFLOW_TYPE = "deleteAvatarWorkflow"
export const TELEGRAM_ACTIVITY_REWARD_WORKFLOW_TYPE = "rewardActivityWorkflow"
export const TELEGRAM_ACTIVITY_REWARD_WORKFLOW_ID = "activity-reward"

export type AvatarManagedBotCreatedSignalInput = {
  managedBotId: string
  managedBotUsername: string
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

export const avatarManagedBotCreatedSignal =
  defineSignal<[AvatarManagedBotCreatedSignalInput]>("avatarManagedBotCreated")

export function getAvatarProvisionWorkflowId(operationId: number): string {
  return `avatar-provision-${operationId}`
}
