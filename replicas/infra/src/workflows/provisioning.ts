import type {
  DeleteGatewayWorkflowInput,
  DeletePostgresDatabaseWorkflowInput,
  DeleteStorageBucketWorkflowInput,
  DeleteTemporalNamespaceWorkflowInput,
  EnsureGatewayWorkflowInput,
  InfraActivities,
  ProvisionPostgresDatabaseWorkflowInput,
  ProvisionStorageBucketWorkflowInput,
  ProvisionTemporalNamespaceWorkflowInput,
  ProvisionTemporaryPostgresDatabaseWorkflowInput,
  WakeReplicaAfterTimerWorkflowInput,
} from "../definitions"
import { safeSleep } from "@reside/common/workflow"
import { errorToString } from "@reside/utils"
import { log, proxyActivities, sleep } from "@temporalio/workflow"

const TEMPORARY_POSTGRES_DATABASE_TTL_MS = 24 * 60 * 60 * 1000

const {
  getProvisionOperationById,
  provisionPostgresDatabase,
  connectMathesarDatabase,
  disconnectMathesarDatabase,
  provisionTemporalNamespace,
  provisionStorageBucket,
  ensureGateway,
  deletePostgresDatabase,
  deleteStorageBucket,
  deleteTemporalNamespace,
  deleteGateway,
  pingReplica,
  setOperationCompleted,
  setOperationFailed,
} = proxyActivities<InfraActivities>({
  scheduleToCloseTimeout: "5 minutes",
})

export async function wakeReplicaAfterTimerWorkflow({
  callbackEndpoint,
  delayMs,
}: WakeReplicaAfterTimerWorkflowInput): Promise<void> {
  log.info("waiting before wake-up ping", {
    callbackEndpoint,
    delayMs,
  })

  await sleep(delayMs)

  log.info("sending wake-up ping", {
    callbackEndpoint,
  })

  await pingReplica({ callbackEndpoint })
}

export async function provisionPostgresDatabaseWorkflow({
  operationId,
}: ProvisionPostgresDatabaseWorkflowInput): Promise<void> {
  const operation = await getProvisionOperationById({ operationId })

  if (operation.type !== "PROVISION_POSTGRES_DATABASE") {
    throw new Error(`Operation "${operationId}" is not a PostgreSQL provisioning operation`)
  }

  if (operation.postgresDatabase === null) {
    throw new Error(`Operation "${operationId}" is missing PostgreSQL database relation`)
  }

  try {
    await provisionPostgresDatabase({ postgresDatabase: operation.postgresDatabase })
    await connectMathesarDatabase({ postgresDatabase: operation.postgresDatabase })
    await setOperationCompleted({ operationId: operation.id })
  } catch (error) {
    await setOperationFailed({
      operationId: operation.id,
      failureReason: "PROVISIONING_FAILED",
      failureMessage: errorToString(error),
    })
    throw error
  }
}

export async function provisionTemporaryPostgresDatabaseWorkflow({
  operationId,
}: ProvisionTemporaryPostgresDatabaseWorkflowInput): Promise<void> {
  const operation = await getProvisionOperationById({ operationId })

  if (operation.type !== "PROVISION_TEMPORARY_POSTGRES_DATABASE") {
    throw new Error(
      `Operation "${operationId}" is not a temporary PostgreSQL provisioning operation`,
    )
  }

  if (operation.postgresDatabase === null) {
    throw new Error(`Operation "${operationId}" is missing PostgreSQL database relation`)
  }

  try {
    await provisionPostgresDatabase({ postgresDatabase: operation.postgresDatabase })
    await setOperationCompleted({ operationId: operation.id })
  } catch (error) {
    await setOperationFailed({
      operationId: operation.id,
      failureReason: "PROVISIONING_FAILED",
      failureMessage: errorToString(error),
    })
    throw error
  }

  await safeSleep(TEMPORARY_POSTGRES_DATABASE_TTL_MS)
  await deletePostgresDatabase({ name: operation.postgresDatabase.database })
}

export async function provisionTemporalNamespaceWorkflow({
  operationId,
}: ProvisionTemporalNamespaceWorkflowInput): Promise<void> {
  const operation = await getProvisionOperationById({ operationId })

  if (operation.type !== "PROVISION_TEMPORAL_NAMESPACE") {
    throw new Error(`Operation "${operationId}" is not a Temporal provisioning operation`)
  }

  if (operation.temporalNamespace === null) {
    throw new Error(`Operation "${operationId}" is missing Temporal namespace relation`)
  }

  try {
    await provisionTemporalNamespace({ temporalNamespace: operation.temporalNamespace })
    await setOperationCompleted({ operationId: operation.id })
  } catch (error) {
    await setOperationFailed({
      operationId: operation.id,
      failureReason: "PROVISIONING_FAILED",
      failureMessage: errorToString(error),
    })
    throw error
  }
}

export async function provisionStorageBucketWorkflow({
  operationId,
}: ProvisionStorageBucketWorkflowInput): Promise<void> {
  const operation = await getProvisionOperationById({ operationId })

  if (operation.type !== "PROVISION_STORAGE_BUCKET") {
    throw new Error(`Operation "${operationId}" is not a storage bucket provisioning operation`)
  }

  if (operation.storageBucket === null) {
    throw new Error(`Operation "${operationId}" is missing storage bucket relation`)
  }

  try {
    await provisionStorageBucket({ storageBucket: operation.storageBucket })
    await setOperationCompleted({ operationId: operation.id })
  } catch (error) {
    await setOperationFailed({
      operationId: operation.id,
      failureReason: "PROVISIONING_FAILED",
      failureMessage: errorToString(error),
    })
    throw error
  }
}

export async function ensureGatewayWorkflow({
  operationId,
}: EnsureGatewayWorkflowInput): Promise<void> {
  const operation = await getProvisionOperationById({ operationId })

  if (operation.type !== "ENSURE_GATEWAY") {
    throw new Error(`Operation "${operationId}" is not a gateway ensure operation`)
  }

  if (operation.gateway === null) {
    throw new Error(`Operation "${operationId}" is missing gateway relation`)
  }

  try {
    await ensureGateway({ gateway: operation.gateway })
    await setOperationCompleted({ operationId: operation.id })
  } catch (error) {
    await setOperationFailed({
      operationId: operation.id,
      failureReason: "PROVISIONING_FAILED",
      failureMessage: errorToString(error),
    })
    throw error
  }
}

export async function deletePostgresDatabaseWorkflow({
  operationId,
}: DeletePostgresDatabaseWorkflowInput): Promise<void> {
  const operation = await getProvisionOperationById({ operationId })

  if (operation.type !== "DELETE_POSTGRES_DATABASE") {
    throw new Error(`Operation "${operationId}" is not a PostgreSQL deletion operation`)
  }

  if (operation.postgresDatabase === null) {
    throw new Error(`Operation "${operationId}" is missing PostgreSQL database relation`)
  }

  try {
    await disconnectMathesarDatabase({ postgresDatabase: operation.postgresDatabase })
    await deletePostgresDatabase({ name: operation.postgresDatabase.database })
    await setOperationCompleted({ operationId: operation.id })
  } catch (error) {
    await setOperationFailed({
      operationId: operation.id,
      failureReason: "REAPER_ACTION_FAILED",
      failureMessage: errorToString(error),
    })
    throw error
  }
}

export async function deleteTemporalNamespaceWorkflow({
  operationId,
}: DeleteTemporalNamespaceWorkflowInput): Promise<void> {
  const operation = await getProvisionOperationById({ operationId })

  if (operation.type !== "DELETE_TEMPORAL_NAMESPACE") {
    throw new Error(`Operation "${operationId}" is not a Temporal namespace deletion operation`)
  }

  if (operation.temporalNamespace === null) {
    throw new Error(`Operation "${operationId}" is missing Temporal namespace relation`)
  }

  try {
    await deleteTemporalNamespace({ temporalNamespaceId: operation.temporalNamespace.id })
    await setOperationCompleted({ operationId: operation.id })
  } catch (error) {
    await setOperationFailed({
      operationId: operation.id,
      failureReason: "REAPER_ACTION_FAILED",
      failureMessage: errorToString(error),
    })
    throw error
  }
}

export async function deleteGatewayWorkflow({
  operationId,
}: DeleteGatewayWorkflowInput): Promise<void> {
  const operation = await getProvisionOperationById({ operationId })

  if (operation.type !== "DELETE_GATEWAY") {
    throw new Error(`Operation "${operationId}" is not a gateway deletion operation`)
  }

  if (operation.gateway === null) {
    throw new Error(`Operation "${operationId}" is missing gateway relation`)
  }

  try {
    await deleteGateway({ gatewayId: operation.gateway.id })
    await setOperationCompleted({ operationId: operation.id })
  } catch (error) {
    await setOperationFailed({
      operationId: operation.id,
      failureReason: "REAPER_ACTION_FAILED",
      failureMessage: errorToString(error),
    })
    throw error
  }
}

export async function deleteStorageBucketWorkflow({
  operationId,
}: DeleteStorageBucketWorkflowInput): Promise<void> {
  const operation = await getProvisionOperationById({ operationId })

  if (operation.type !== "DELETE_STORAGE_BUCKET") {
    throw new Error(`Operation "${operationId}" is not a storage bucket deletion operation`)
  }

  if (operation.storageBucket === null) {
    throw new Error(`Operation "${operationId}" is missing storage bucket relation`)
  }

  try {
    await deleteStorageBucket({ storageBucketId: operation.storageBucket.id })
    await setOperationCompleted({ operationId: operation.id })
  } catch (error) {
    await setOperationFailed({
      operationId: operation.id,
      failureReason: "REAPER_ACTION_FAILED",
      failureMessage: errorToString(error),
    })
    throw error
  }
}
