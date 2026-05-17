import type { WorkflowService } from "@temporalio/client"
import type { Pool } from "pg"
import type { Operation, PostgresDatabase, PrismaClient, TemporalNamespace } from "../../database"
import { BatchV1Api, CoreV1Api, CustomObjectsApi } from "@kubernetes/client-node"
import * as PingApi from "@reside/api/common/ping.v1"
import {
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
  ensureMinioBucketAccess,
  ensureTemporalNamespace,
  loadInfraGatewayConfig,
  loadMathesarAdminCredentials,
  loadMinioAdminConfig,
  MINIO_SERVICE_NAME,
  MINIO_SERVICE_PORT,
  type PostgresAdminConfig,
  provisionPostgresDatabase,
  upsertGatewayResources,
} from "../../shared"

export type DatabaseActivities = ReturnType<typeof createDatabaseActivities>
export type ProvisionOperation = Awaited<ReturnType<typeof loadProvisionOperationById>>

export function createDatabaseActivities(
  prisma: PrismaClient,
  adminPool: Pool,
  adminConfig: PostgresAdminConfig,
  workflowService: WorkflowService,
  operationService: GenericOperationService<Operation>,
) {
  const namespace = getReplicaNamespace()
  const batchApi = kubeConfig.makeApiClient(BatchV1Api)
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)
  const customObjectsApi = kubeConfig.makeApiClient(CustomObjectsApi)

  const getProvisionOperationById = async (operationId: number): Promise<ProvisionOperation> => {
    return await loadProvisionOperationById(prisma, operationId)
  }

  return {
    async provisionPostgresDatabase(postgresDatabase: PostgresDatabase): Promise<void> {
      await provisionPostgresDatabase(adminPool, adminConfig, postgresDatabase)
    },

    async connectMathesarDatabase(postgresDatabase: PostgresDatabase): Promise<void> {
      const adminCredentials = await loadMathesarAdminCredentials(coreApi, namespace)
      await connectMathesarDatabaseAsAdmin({
        baseUrl: buildMathesarBaseUrl(namespace),
        username: adminCredentials.username,
        password: adminCredentials.password,
        database: postgresDatabase,
        adminConfig,
      })
    },

    async provisionTemporalNamespace(temporalNamespace: TemporalNamespace): Promise<void> {
      await ensureTemporalNamespace(workflowService, temporalNamespace.namespace)
    },

    async provisionStorageBucket(storageBucket: {
      id: number
      bucket: string
      accessKey: string
      secretKey: string
      provisionedAt: Date | null
    }): Promise<void> {
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

    async ensureGateway(gateway: {
      name: string
      ownerReplicaName: string
      title: string
      description: string | null
    }): Promise<void> {
      const infraGatewayConfig = await loadInfraGatewayConfig(coreApi, namespace)
      await upsertGatewayResources(customObjectsApi, infraGatewayConfig, gateway)
    },

    async pingReplica(callbackEndpoint: string): Promise<void> {
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
      storageBucket: true,
      gateway: true,
    },
  })

  if (operation === null) {
    throw new Error(`Operation "${operationId}" was not found`)
  }

  return operation
}
