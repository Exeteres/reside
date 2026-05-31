import type {
  EnsureGatewayWorkflowInput,
  InfraActivities,
  ProvisionPostgresDatabaseWorkflowInput,
  ProvisionStorageBucketWorkflowInput,
  ProvisionTemporalNamespaceWorkflowInput,
  WakeReplicaAfterTimerWorkflowInput,
} from "../definitions"
import { errorToString } from "@reside/utils"
import { log, proxyActivities, sleep } from "@temporalio/workflow"

const {
  getProvisionOperationById,
  provisionPostgresDatabase,
  connectMathesarDatabase,
  provisionTemporalNamespace,
  provisionStorageBucket,
  ensureGateway,
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
