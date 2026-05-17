import type { DatabaseE2EContext } from "./context"
import { createAuthInterceptor, createPostgresPoolFromCredentials } from "@reside/common"
import { Connection } from "@temporalio/client"
import {
  loadPostgresAdminConfig,
  POSTGRES_SERVICE_NAME,
  TEMPORAL_FRONTEND_SERVICE_NAME,
} from "../shared"

/**
 * Validates the database replica infrastructure and service accessibility.
 *
 * @param context The shared database e2e context.
 */
export async function assertDatabaseReplicaHealth(context: DatabaseE2EContext): Promise<void> {
  await assertPostgresStatefulSetReady(context)
  await assertPostgresAccessible()
  await assertTemporalAccessible(context)
}

async function assertPostgresStatefulSetReady(context: DatabaseE2EContext): Promise<void> {
  const statefulSet = await context.appsApi.readNamespacedStatefulSetStatus({
    name: POSTGRES_SERVICE_NAME,
    namespace: context.namespace,
  })
  const readyReplicas = statefulSet.status?.readyReplicas ?? 0
  if (readyReplicas < 1) {
    throw new Error(`PostgreSQL StatefulSet is not ready in namespace "${context.namespace}"`)
  }
}

async function assertPostgresAccessible(): Promise<void> {
  const adminConfig = await loadPostgresAdminConfig()
  const { pool } = createPostgresPoolFromCredentials(adminConfig)

  try {
    const result = await pool.query<{ current_database: string }>(
      "SELECT current_database() AS current_database",
    )
    const row = result.rows[0]
    if (!row || row.current_database !== adminConfig.database) {
      throw new Error("Unexpected PostgreSQL connectivity result")
    }
  } finally {
    await pool.end()
  }
}

async function assertTemporalAccessible(context: DatabaseE2EContext): Promise<void> {
  await context.coreApi.readNamespacedService({
    name: TEMPORAL_FRONTEND_SERVICE_NAME,
    namespace: context.namespace,
  })

  const address = `${TEMPORAL_FRONTEND_SERVICE_NAME}.${context.namespace}.svc.cluster.local:7233`
  const connection = await Connection.connect({
    address,
    interceptors: [createAuthInterceptor(address)],
  })

  const response = await connection.workflowService.describeNamespace({
    namespace: context.namespace,
  })

  if (response.namespaceInfo?.name !== context.namespace) {
    throw new Error(`Temporal namespace "${context.namespace}" is not accessible`)
  }
}
