export type RegisteredReplicaSummary = {
  name: string
  title: string
  description: string | null
  image: string | null
  internalEndpoint: string
  publicEndpoint: string | null
  node: string | null
}

export type SetReplicaNodeInput = {
  /**
   * The name of the replica to pin.
   */
  replicaName: string

  /**
   * The node name to assign to the replica.
   */
  nodeName: string
}

export type ResetReplicaNodeInput = {
  /**
   * The name of the replica to unpin.
   */
  replicaName: string
}

export type ReconcileRegistrationOperationInput = {
  /**
   * The registration operation identifier.
   */
  operationId: number
}

export type ReconcileRegistrationOperationStatus = "completed" | "pending"

export type ListRegisteredReplicasOutput = {
  /**
   * The current list of registered replicas.
   */
  replicas: RegisteredReplicaSummary[]
}

export type ReconcileRegistrationOperationOutput = {
  /**
   * The current reconciliation status.
   */
  status: ReconcileRegistrationOperationStatus
}

export type ReplicaManagementActivities = {
  /**
   * Returns the list of registered replicas.
   */
  listRegisteredReplicas: () => Promise<ListRegisteredReplicasOutput>

  /**
   * Assigns a replica to a specific node.
   */
  setReplicaNode: (input: SetReplicaNodeInput) => Promise<void>

  /**
   * Clears a node assignment for a replica.
   */
  resetReplicaNode: (input: ResetReplicaNodeInput) => Promise<void>
}

export type RegistrationActivities = {
  /**
   * Reconciles a registration operation state.
   */
  reconcileRegistrationOperation: (
    input: ReconcileRegistrationOperationInput,
  ) => Promise<ReconcileRegistrationOperationOutput>
}
