import type { WorkflowService } from "@temporalio/client"
import type { Pool } from "pg"
import type { Operation, PrismaClient } from "../../database"
import type { InfraActivities, ProvisionOperation } from "../../definitions"
import { BatchV1Api, CoreV1Api, CustomObjectsApi } from "@kubernetes/client-node"
import * as PingApi from "@reside/api/common/ping.v1"
import {
  type CommonServices,
  createChannel,
  createClient,
  type GenericOperationService,
  getReplicaNamespace,
  kubeConfig,
  logger,
} from "@reside/common"
import {
  buildMathesarBaseUrl,
  connectMathesarDatabaseAsAdmin,
  deleteMinioBucketAccess,
  ensureMinioBucketAccess,
  ensureTemporalNamespace,
  loadInfraGatewayConfig,
  loadMathesarAdminCredentials,
  loadMinioAdminConfig,
  MINIO_SERVICE_NAME,
  MINIO_SERVICE_PORT,
  type PostgresAdminConfig,
  provisionPostgresDatabase,
  quoteIdentifier,
  upsertGatewayResources,
} from "../../shared"

type DatabaseActivityServices = CommonServices<"infra"> & {
  prisma: PrismaClient
  adminPool: Pool
  adminConfig: PostgresAdminConfig
  workflowService: WorkflowService
  operationService: GenericOperationService<Operation>
}

export function createDatabaseActivities({
  prisma,
  adminPool,
  adminConfig,
  workflowService,
  operationService,
}: DatabaseActivityServices): InfraActivities {
  const namespace = getReplicaNamespace()
  const batchApi = kubeConfig.makeApiClient(BatchV1Api)
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)
  const customObjectsApi = kubeConfig.makeApiClient(CustomObjectsApi)

  return {
    async provisionPostgresDatabase({ postgresDatabase }) {
      await provisionPostgresDatabase(adminPool, adminConfig, postgresDatabase)
    },

    async connectMathesarDatabase({ postgresDatabase }) {
      const adminCredentials = await loadMathesarAdminCredentials(coreApi, namespace)
      await connectMathesarDatabaseAsAdmin({
        baseUrl: buildMathesarBaseUrl(namespace),
        username: adminCredentials.username,
        password: adminCredentials.password,
        database: postgresDatabase,
        adminConfig,
      })
    },

    async provisionTemporalNamespace({ temporalNamespace }) {
      await ensureTemporalNamespace(workflowService, temporalNamespace.namespace)
    },

    async provisionStorageBucket({ storageBucket }) {
      if (storageBucket.provisionedAt) {
        return
      }

      const minioAdminConfig = await loadMinioAdminConfig(coreApi, namespace)

      await ensureMinioBucketAccess({
        batchApi,
        namespace,
        endpoint: minioAdminConfig.endpoint,
        adminUser: minioAdminConfig.username,
        adminPassword: minioAdminConfig.password,
        bucket: storageBucket.bucket,
        accessKey: storageBucket.accessKey,
        secretKey: storageBucket.secretKey,
      })

      await prisma.storageBucket.update({
        where: {
          id: storageBucket.id,
        },
        data: {
          provisionedAt: new Date(),
        },
      })

      logger.info(
        'provisioned storage bucket name="%s" endpoint="%s.%s.svc.cluster.local:%d"',
        storageBucket.bucket,
        MINIO_SERVICE_NAME,
        namespace,
        MINIO_SERVICE_PORT,
      )
    },

    async deleteStorageBucket({ storageBucketId }) {
      const storageBucket = await prisma.storageBucket.findUnique({
        where: {
          id: storageBucketId,
        },
      })
      if (storageBucket === null) {
        return
      }

      const minioAdminConfig = await loadMinioAdminConfig(coreApi, namespace)

      await deleteMinioBucketAccess({
        batchApi,
        namespace,
        endpoint: minioAdminConfig.endpoint,
        adminUser: minioAdminConfig.username,
        adminPassword: minioAdminConfig.password,
        bucket: storageBucket.bucket,
        accessKey: storageBucket.accessKey,
      })

      await prisma.storageBucket.deleteMany({
        where: {
          id: storageBucket.id,
        },
      })
    },

    async ensureGateway({ gateway }) {
      const infraGatewayConfig = await loadInfraGatewayConfig(coreApi, namespace)
      await upsertGatewayResources(customObjectsApi, infraGatewayConfig, gateway)
    },

    async deletePostgresDatabase({ name }) {
      await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)} WITH (FORCE)`)
      await adminPool.query(`DROP USER IF EXISTS ${quoteIdentifier(name)}`)
      await prisma.postgresDatabase.deleteMany({ where: { database: name } })
    },

    async deleteTemporalNamespace({ temporalNamespaceId }) {
      await prisma.temporalNamespace.deleteMany({ where: { id: temporalNamespaceId } })
    },

    async deleteGateway({ gatewayId }) {
      await prisma.gateway.deleteMany({ where: { id: gatewayId } })
    },

    async pingReplica({ callbackEndpoint }) {
      const pingService =
        (PingApi as { PingService?: unknown }).PingService ?? Object.values(PingApi)[0]

      if (!pingService) {
        throw new Error("Ping service descriptor is not available")
      }

      const pingClient = createClient(pingService as never, createChannel(callbackEndpoint)) as {
        ping(request: Record<string, never>): Promise<unknown>
      }

      await pingClient.ping({})

      logger.info("sent wake-up ping to callback endpoint %s", callbackEndpoint)
    },

    async getProvisionOperationById({ operationId }) {
      return await loadProvisionOperationById(prisma, operationId)
    },

    async setOperationCompleted({ operationId }) {
      await operationService.setCompleted(operationId)
    },

    async setOperationFailed({ operationId, failureReason, failureMessage }) {
      await operationService.setFailed(operationId, failureReason, failureMessage)
    },
  }
}

async function loadProvisionOperationById(
  prisma: PrismaClient,
  operationId: number,
): Promise<ProvisionOperation> {
  const operation = await prisma.operation.findUnique({
    where: {
      id: operationId,
    },
    include: {
      postgresDatabase: true,
      temporalNamespace: true,
      storageBucket: true,
      gateway: true,
    },
  })

  if (operation === null) {
    throw new Error(`Operation "${operationId}" was not found`)
  }

  return operation
}
