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

export type DeletePostgresDatabaseWorkflowInput = {
  operationId: number
}

export type DeleteTemporalNamespaceWorkflowInput = {
  operationId: number
}

export type DeleteGatewayWorkflowInput = {
  operationId: number
}

export type DeleteStorageBucketWorkflowInput = {
  operationId: number
}
