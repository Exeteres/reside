import { deliverOperationCompletionWorkflow } from "@reside/common/workflow"
import { errorToString } from "@reside/utils"
import { proxyActivities } from "@temporalio/workflow"

const {
  getProvisionOperationById,
  provisionPostgresDatabase,
  provisionTemporalNamespace,
  setOperationCompleted,
  setOperationFailed,
} = proxyActivities<{
  getProvisionOperationById: (operationId: number) => Promise<{
    id: number
    type: string
    postgresDatabase: unknown | null
    temporalNamespace: unknown | null
  }>
  provisionPostgresDatabase: (postgresDatabase: unknown) => Promise<void>
  provisionTemporalNamespace: (temporalNamespace: unknown) => Promise<void>
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
