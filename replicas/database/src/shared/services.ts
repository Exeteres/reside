import {
  createGenericOperationService,
  createPostgresPoolFromCredentials,
  createTemporalClient,
  type GenericOperationService,
  getReplicaNamespace,
} from "@reside/common"
import { type Operation, PrismaClient } from "../database"
import { resolveOperationResult } from "./operation"
import { loadPostgresAdminConfig } from "./postgres/config"
import { buildReplicaDatabaseName } from "./postgres/provision"
import { createReplicaDatabaseOptions } from "./requirements"

export type DatabaseOperationService = GenericOperationService<Operation>

export async function createServices() {
  const adminConfig = await loadPostgresAdminConfig()
  const { pool: adminPool } = createPostgresPoolFromCredentials(adminConfig)

  const replicaDatabase = buildReplicaDatabaseName(getReplicaNamespace())
  const { adapter } = createPostgresPoolFromCredentials({
    ...adminConfig,
    database: replicaDatabase,
  })

  const prisma = new PrismaClient({ adapter })
  const temporalClient = await createTemporalClient(createReplicaDatabaseOptions())

  const operationService = createGenericOperationService({
    prisma,
    temporalClient,
    getResult: operationId => resolveOperationResult(prisma, operationId),
  })

  return {
    adminConfig,
    adminPool,
    prisma,
    temporalClient,
    operationService,
  }
}
