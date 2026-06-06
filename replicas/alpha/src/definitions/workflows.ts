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
