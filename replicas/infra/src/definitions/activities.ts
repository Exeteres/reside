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

export type EnsureGatewayInput = {
  /**
   * The gateway resource to reconcile.
   */
  gateway: {
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
   * Provisions a Temporal namespace resource.
   */
  provisionTemporalNamespace: (input: ProvisionTemporalNamespaceInput) => Promise<void>

  /**
   * Provisions a storage bucket resource.
   */
  provisionStorageBucket: (input: ProvisionStorageBucketInput) => Promise<void>

  /**
   * Ensures gateway resources are up to date.
   */
  ensureGateway: (input: EnsureGatewayInput) => Promise<void>

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
