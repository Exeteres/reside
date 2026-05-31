export type WakeReplicaAfterTimerWorkflowInput = {
  callbackEndpoint: string
  delayMs: number
}

export type ProvisionPostgresDatabaseWorkflowInput = {
  operationId: number
}

export type ProvisionTemporalNamespaceWorkflowInput = {
  operationId: number
}

export type ProvisionStorageBucketWorkflowInput = {
  operationId: number
}

export type EnsureGatewayWorkflowInput = {
  operationId: number
}
