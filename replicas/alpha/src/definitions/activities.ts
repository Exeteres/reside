export type RegisteredReplicaSummary = {
  name: string
  title: string
  description: string | null
  image: string | null
  internalEndpoint: string
  publicEndpoint: string | null
  node: string | null
  version: string | null
  changes: string | null
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

export type UpdateReplicaAvatarVersionTagInput = {
  /**
   * The target replica technical name.
   */
  replicaName: string

  /**
   * The new replica version.
   */
  newVersion: string
}

export type DeleteReplicaInput = {
  /**
   * The replica technical name.
   */
  replicaName: string
}

export type ReconcileRegistrationOperationStatus = "completed" | "failed" | "pending"

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

  /**
   * The human-readable failure message when reconciliation failed.
   */
  failureMessage?: string
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

  /**
   * Updates managed avatar version tag for a replica in Telegram system chat.
   */
  updateReplicaAvatarVersionTag: (input: UpdateReplicaAvatarVersionTagInput) => Promise<void>

  /**
   * Deletes a replica registration from Alpha.
   */
  unregisterReplica: (input: DeleteReplicaInput) => Promise<void>

  /**
   * Deletes the replica custom resource from the cluster.
   */
  deleteReplicaFromCluster: (input: DeleteReplicaInput) => Promise<void>

  /**
   * Marks an operation as completed.
   */
  completeOperation: (input: { operationId: number }) => Promise<void>

  /**
   * Marks an operation as failed.
   */
  failOperation: (input: { operationId: number; reason: string; message: string }) => Promise<void>
}
