import type { Operation, PostgresDatabase, StorageBucket, TemporalNamespace } from "../database"

export type GetProvisionOperationByIdInput = {
  /**
   * The provisioning operation identifier.
   */
  operationId: number
}

export type GetProvisionOperationByIdOutput = ProvisionOperation

export type SetOperationCompletedInput = {
  /**
   * The operation identifier to complete.
   */
  operationId: number
}

export type SetOperationFailedInput = {
  /**
   * The operation identifier to fail.
   */
  operationId: number

  /**
   * The failure reason code.
   */
  failureReason: string

  /**
   * The failure message text.
   */
  failureMessage: string
}

export type ProvisionPostgresDatabaseInput = {
  /**
   * The PostgreSQL database resource to provision.
   */
  postgresDatabase: PostgresDatabase
}

export type ConnectMathesarDatabaseInput = {
  /**
   * The PostgreSQL database resource to register in Mathesar.
   */
  postgresDatabase: PostgresDatabase
}

export type DisconnectMathesarDatabaseInput = {
  /**
   * The PostgreSQL database resource to unregister from Mathesar.
   */
  postgresDatabase: PostgresDatabase
}

export type ProvisionTemporalNamespaceInput = {
  /**
   * The Temporal namespace resource to provision.
   */
  temporalNamespace: TemporalNamespace
}

export type ProvisionStorageBucketInput = {
  /**
   * The storage bucket resource to provision.
   */
  storageBucket: StorageBucket
}

export type DeleteStorageBucketInput = {
  /**
   * The storage bucket record identifier.
   */
  storageBucketId: number
}

export type EnsureGatewayInput = {
  /**
   * The gateway resource to reconcile.
   */
  gateway: {
    /**
     * The gateway numeric identifier.
     */
    id: number

    /**
     * The gateway unique name.
     */
    name: string

    /**
     * The replica that owns the gateway.
     */
    ownerReplicaName: string

    /**
     * The human-readable gateway title.
     */
    title: string

    /**
     * The optional gateway description.
     */
    description: string | null
  }
}

export type DeletePostgresDatabaseInput = {
  /**
   * The database name to delete.
   */
  name: string
}

export type DeleteTemporalNamespaceInput = {
  /**
   * The Temporal namespace record identifier.
   */
  temporalNamespaceId: number
}

export type DeleteGatewayInput = {
  /**
   * The gateway record identifier.
   */
  gatewayId: number
}

export type PingReplicaInput = {
  /**
   * The callback endpoint URL.
   */
  callbackEndpoint: string
}

export type ProvisionOperation = {
  id: number
  type: Operation["type"]
  postgresDatabase: PostgresDatabase | null
  temporalNamespace: TemporalNamespace | null
  storageBucket: StorageBucket | null
  gateway: EnsureGatewayInput["gateway"] | null
}

export type InfraActivities = {
  /**
   * Loads a provisioning operation with related resources.
   */
  getProvisionOperationById: (
    input: GetProvisionOperationByIdInput,
  ) => Promise<GetProvisionOperationByIdOutput>

  /**
   * Provisions a PostgreSQL database resource.
   */
  provisionPostgresDatabase: (input: ProvisionPostgresDatabaseInput) => Promise<void>

  /**
   * Connects a PostgreSQL database to Mathesar.
   */
  connectMathesarDatabase: (input: ConnectMathesarDatabaseInput) => Promise<void>

  /**
   * Disconnects a PostgreSQL database from Mathesar.
   */
  disconnectMathesarDatabase: (input: DisconnectMathesarDatabaseInput) => Promise<void>

  /**
   * Provisions a Temporal namespace resource.
   */
  provisionTemporalNamespace: (input: ProvisionTemporalNamespaceInput) => Promise<void>

  /**
   * Provisions a storage bucket resource.
   */
  provisionStorageBucket: (input: ProvisionStorageBucketInput) => Promise<void>

  /**
   * Deletes a storage bucket resource and its credentials.
   */
  deleteStorageBucket: (input: DeleteStorageBucketInput) => Promise<void>

  /**
   * Ensures gateway resources are up to date.
   */
  ensureGateway: (input: EnsureGatewayInput) => Promise<void>

  /**
   * Deletes a PostgreSQL database and role.
   */
  deletePostgresDatabase: (input: DeletePostgresDatabaseInput) => Promise<void>

  /**
   * Deletes a Temporal namespace registration.
   */
  deleteTemporalNamespace: (input: DeleteTemporalNamespaceInput) => Promise<void>

  /**
   * Deletes a gateway registration.
   */
  deleteGateway: (input: DeleteGatewayInput) => Promise<void>

  /**
   * Sends a wake-up ping to a replica endpoint.
   */
  pingReplica: (input: PingReplicaInput) => Promise<void>

  /**
   * Marks an operation as completed.
   */
  setOperationCompleted: (input: SetOperationCompletedInput) => Promise<void>

  /**
   * Marks an operation as failed.
   */
  setOperationFailed: (input: SetOperationFailedInput) => Promise<void>
}
