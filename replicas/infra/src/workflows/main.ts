import { deliverOperationCompletionWorkflow } from "@reside/common/workflow"
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
} = proxyActivities<{
  getProvisionOperationById: (operationId: number) => Promise<{
    id: number
    type: string
    postgresDatabase: unknown | null
    temporalNamespace: unknown | null
    storageBucket: unknown | null
    gateway: unknown | null
  }>
  provisionPostgresDatabase: (postgresDatabase: unknown) => Promise<void>
  connectMathesarDatabase: (postgresDatabase: unknown) => Promise<void>
  provisionTemporalNamespace: (temporalNamespace: unknown) => Promise<void>
  provisionStorageBucket: (storageBucket: unknown) => Promise<void>
  ensureGateway: (gateway: unknown) => Promise<void>
  pingReplica: (callbackEndpoint: string) => Promise<void>
  setOperationCompleted: (operationId: number) => Promise<void>
  setOperationFailed: (
    operationId: number,
    failureReason: string,
    failureMessage: string,
  ) => Promise<void>
}>({
  scheduleToCloseTimeout: "5 minutes",
})

export { deliverOperationCompletionWorkflow }

export async function wakeReplicaAfterTimerWorkflow(input: {
  callbackEndpoint: string
  delayMs: number
}): Promise<void> {
  log.info("waiting before wake-up ping", {
    callbackEndpoint: input.callbackEndpoint,
    delayMs: input.delayMs,
  })

  await sleep(input.delayMs)

  log.info("sending wake-up ping", {
    callbackEndpoint: input.callbackEndpoint,
  })

  await pingReplica(input.callbackEndpoint)
}

export async function provisionPostgresDatabaseWorkflow(operationId: number): Promise<void> {
  const operation = await getProvisionOperationById(operationId)

  if (operation.type !== "PROVISION_POSTGRES_DATABASE") {
    throw new Error(`Operation "${operationId}" is not a PostgreSQL provisioning operation`)
  }

  if (operation.postgresDatabase === null) {
    throw new Error(`Operation "${operationId}" is missing PostgreSQL database relation`)
  }

  try {
    await provisionPostgresDatabase(operation.postgresDatabase)
    await connectMathesarDatabase(operation.postgresDatabase)
    await setOperationCompleted(operation.id)
  } catch (error) {
    await setOperationFailed(operation.id, "PROVISIONING_FAILED", errorToString(error))
    throw error
  }
}

export async function provisionTemporalNamespaceWorkflow(operationId: number): Promise<void> {
  const operation = await getProvisionOperationById(operationId)

  if (operation.type !== "PROVISION_TEMPORAL_NAMESPACE") {
    throw new Error(`Operation "${operationId}" is not a Temporal provisioning operation`)
  }

  if (operation.temporalNamespace === null) {
    throw new Error(`Operation "${operationId}" is missing Temporal namespace relation`)
  }

  try {
    await provisionTemporalNamespace(operation.temporalNamespace)
    await setOperationCompleted(operation.id)
  } catch (error) {
    await setOperationFailed(operation.id, "PROVISIONING_FAILED", errorToString(error))
    throw error
  }
}

export async function provisionStorageBucketWorkflow(operationId: number): Promise<void> {
  const operation = await getProvisionOperationById(operationId)

  if (operation.type !== "PROVISION_STORAGE_BUCKET") {
    throw new Error(`Operation "${operationId}" is not a storage bucket provisioning operation`)
  }

  if (operation.storageBucket === null) {
    throw new Error(`Operation "${operationId}" is missing storage bucket relation`)
  }

  try {
    await provisionStorageBucket(operation.storageBucket)
    await setOperationCompleted(operation.id)
  } catch (error) {
    await setOperationFailed(operation.id, "PROVISIONING_FAILED", errorToString(error))
    throw error
  }
}

export async function ensureGatewayWorkflow(operationId: number): Promise<void> {
  const operation = await getProvisionOperationById(operationId)

  if (operation.type !== "ENSURE_GATEWAY") {
    throw new Error(`Operation "${operationId}" is not a gateway ensure operation`)
  }

  if (operation.gateway === null) {
    throw new Error(`Operation "${operationId}" is missing gateway relation`)
  }

  try {
    await ensureGateway(operation.gateway)
    await setOperationCompleted(operation.id)
  } catch (error) {
    await setOperationFailed(operation.id, "PROVISIONING_FAILED", errorToString(error))
    throw error
  }
}
