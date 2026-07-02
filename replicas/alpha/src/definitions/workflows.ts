export type WaitForReplicaRegistrationWorkflowInput = {
  operationId: number
}

export type NotifyReplicaReleaseNotesWorkflowInput = {
  replicaName: string
  replicaTitle: string
  oldVersion: string | null
  newVersion: string
  changes: string | null
}

export type UnregisterReplicaWorkflowInput = {
  operationId: number
  replicaName: string
}

export type DeleteReplicaFromClusterWorkflowInput = {
  operationId: number
  replicaName: string
}
