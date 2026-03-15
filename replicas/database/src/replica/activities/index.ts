import type { WorkflowService } from "@temporalio/client"
import type { Pool } from "pg"
import type { PostgresDatabase, PrismaClient, TemporalNamespace } from "../../database"
import {
  type DatabaseOperationService,
  ensureTemporalNamespace,
  type PostgresAdminConfig,
  provisionPostgresDatabase,
} from "../../shared"

export type DatabaseActivities = ReturnType<typeof createDatabaseActivities>
export type ProvisionOperation = Awaited<ReturnType<typeof loadProvisionOperationById>>

export function createDatabaseActivities(
  prisma: PrismaClient,
  adminPool: Pool,
  adminConfig: PostgresAdminConfig,
  workflowService: WorkflowService,
  operationService: DatabaseOperationService,
) {
  const getProvisionOperationById = async (operationId: number): Promise<ProvisionOperation> => {
    return await loadProvisionOperationById(prisma, operationId)
  }

  return {
    async provisionPostgresDatabase(postgresDatabase: PostgresDatabase): Promise<void> {
      await provisionPostgresDatabase(adminPool, adminConfig, postgresDatabase)
    },

    async provisionTemporalNamespace(temporalNamespace: TemporalNamespace): Promise<void> {
      await ensureTemporalNamespace(workflowService, temporalNamespace.namespace)
    },

    getProvisionOperationById,
    setOperationCompleted: operationService.setCompleted,
    setOperationFailed: operationService.setFailed,
  }
}

async function loadProvisionOperationById(prisma: PrismaClient, operationId: number) {
  const operation = await prisma.operation.findUnique({
    where: {
      id: operationId,
    },
    include: {
      postgresDatabase: true,
      temporalNamespace: true,
    },
  })

  if (operation === null) {
    throw new Error(`Operation "${operationId}" was not found`)
  }

  return operation
}
