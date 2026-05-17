import type { Empty } from "@bufbuild/protobuf/wkt"
import type { ProvisionServiceImplementation } from "@reside/api/infra/provision.v1"
import type { GenericOperationService } from "@reside/common"
import type { Client } from "@temporalio/client"
import type {
  Operation,
  PostgresDatabase,
  PrismaClient,
  StorageBucket,
  TemporalNamespace,
} from "../../database"
import { randomBytes } from "node:crypto"
import { Code, ConnectError, type HandlerContext } from "@connectrpc/connect"
import {
  authenticateReplica,
  DEFAULT_TEMPORAL_TASK_QUEUE,
  getReplicaNamespace,
} from "@reside/common"
import { WorkflowExecutionAlreadyStartedError, WorkflowIdReusePolicy } from "@temporalio/client"
import { OperationStatus, OperationType } from "../../database"
import { strings } from "../../locale"
import {
  buildReplicaDatabaseName,
  MINIO_SERVICE_NAME,
  MINIO_SERVICE_PORT,
  normalizeBucketName,
  type PostgresAdminConfig,
  TEMPORAL_FRONTEND_PORT,
  TEMPORAL_FRONTEND_SERVICE_NAME,
} from "../../shared"

export function createProvisionService({
  prisma,
  adminConfig,
  temporalClient,
  operationService,
}: {
  prisma: PrismaClient
  adminConfig: PostgresAdminConfig
  temporalClient: Client
  operationService: GenericOperationService<Operation>
}) {
  const namespace = getReplicaNamespace()

  const service: ProvisionServiceImplementation = {
    async getPostgresDatabaseCredentials(_request: Empty, context: HandlerContext) {
      const identity = await authenticateReplica(context)
      const replicaNamespace = `replica-${identity.name}`
      const payload = await prisma.$transaction(async tx => {
        const databaseName = buildReplicaDatabaseName(replicaNamespace)
        let postgresDatabase = await tx.postgresDatabase.findUnique({
          where: {
            database: databaseName,
          },
        })

        if (postgresDatabase !== null) {
          const pendingOperation = await tx.operation.findFirst({
            where: {
              postgresDatabaseId: postgresDatabase.id,
              type: OperationType.PROVISION_POSTGRES_DATABASE,
              status: OperationStatus.PENDING,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          })

          if (pendingOperation !== null) {
            return {
              kind: "operation" as const,
              value: pendingOperation,
            }
          }

          const completedOperation = await tx.operation.findFirst({
            where: {
              postgresDatabaseId: postgresDatabase.id,
              type: OperationType.PROVISION_POSTGRES_DATABASE,
              status: OperationStatus.COMPLETED,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          })

          if (completedOperation !== null) {
            return {
              kind: "result" as const,
              value: buildPostgresCredentials(postgresDatabase, adminConfig),
            }
          }
        } else {
          postgresDatabase = await tx.postgresDatabase.create({
            data: {
              database: databaseName,
              password: randomBytes(24).toString("base64url"),
            },
          })
        }

        const operation = await tx.operation.create({
          data: {
            title: strings.operations.postgres.title(replicaNamespace),
            description: strings.operations.postgres.description(replicaNamespace),
            type: OperationType.PROVISION_POSTGRES_DATABASE,
            status: OperationStatus.PENDING,
            failureReason: null,
            failureMessage: null,
            callbackEndpoint: null,
            resolvedAt: null,
            postgresDatabaseId: postgresDatabase.id,
          },
        })

        await startProvisioningWorkflow(temporalClient, "database", operation.id)

        return {
          kind: "operation" as const,
          value: operation,
        }
      })

      if (payload.kind === "result") {
        return {
          credentials: {
            case: "result",
            value: payload.value,
          },
        }
      }

      return {
        credentials: {
          case: "operation",
          value: await operationService.toApiOperation(payload.value.id),
        },
      }
    },

    async getTemporalNamespaceCredentials(_request: Empty, context: HandlerContext) {
      const identity = await authenticateReplica(context)
      const replicaNamespace = `replica-${identity.name}`
      const payload = await prisma.$transaction(async tx => {
        let temporalNamespace = await tx.temporalNamespace.findUnique({
          where: {
            namespace: replicaNamespace,
          },
        })

        if (temporalNamespace !== null) {
          const pendingOperation = await tx.operation.findFirst({
            where: {
              temporalNamespaceId: temporalNamespace.id,
              type: OperationType.PROVISION_TEMPORAL_NAMESPACE,
              status: OperationStatus.PENDING,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          })

          if (pendingOperation !== null) {
            return {
              kind: "operation" as const,
              value: pendingOperation,
            }
          }

          const completedOperation = await tx.operation.findFirst({
            where: {
              temporalNamespaceId: temporalNamespace.id,
              type: OperationType.PROVISION_TEMPORAL_NAMESPACE,
              status: OperationStatus.COMPLETED,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          })

          if (completedOperation !== null) {
            return {
              kind: "result" as const,
              value: buildTemporalCredentials(temporalNamespace),
            }
          }
        } else {
          temporalNamespace = await tx.temporalNamespace.create({
            data: {
              namespace: replicaNamespace,
            },
          })
        }

        const operation = await tx.operation.create({
          data: {
            title: strings.operations.temporal.title(replicaNamespace),
            description: strings.operations.temporal.description(replicaNamespace),
            type: OperationType.PROVISION_TEMPORAL_NAMESPACE,
            status: OperationStatus.PENDING,
            failureReason: null,
            failureMessage: null,
            callbackEndpoint: null,
            resolvedAt: null,
            temporalNamespaceId: temporalNamespace.id,
          },
        })

        await startProvisioningWorkflow(temporalClient, "temporal-namespace", operation.id)

        return {
          kind: "operation" as const,
          value: operation,
        }
      })

      if (payload.kind === "result") {
        return {
          credentials: {
            case: "result",
            value: payload.value,
          },
        }
      }

      return {
        credentials: {
          case: "operation",
          value: await operationService.toApiOperation(payload.value.id),
        },
      }
    },

    async getStorageBucketCredentials(_request: Empty, context: HandlerContext) {
      const identity = await authenticateReplica(context)
      const replicaNamespace = `replica-${identity.name}`

      const payload = await prisma.$transaction(async tx => {
        let storageBucket = await tx.storageBucket.findUnique({
          where: {
            replicaNamespace,
          },
        })

        if (storageBucket !== null) {
          const pendingOperation = await tx.operation.findFirst({
            where: {
              storageBucketId: storageBucket.id,
              type: OperationType.PROVISION_STORAGE_BUCKET,
              status: OperationStatus.PENDING,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          })

          if (pendingOperation !== null) {
            return {
              kind: "operation" as const,
              value: pendingOperation,
            }
          }

          const completedOperation = await tx.operation.findFirst({
            where: {
              storageBucketId: storageBucket.id,
              type: OperationType.PROVISION_STORAGE_BUCKET,
              status: OperationStatus.COMPLETED,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          })

          if (completedOperation !== null) {
            return {
              kind: "result" as const,
              value: buildStorageCredentials(storageBucket, namespace),
            }
          }
        } else {
          storageBucket = await tx.storageBucket.create({
            data: {
              replicaNamespace,
              bucket: normalizeBucketName(replicaNamespace),
              accessKey: buildStorageAccessKey(),
              secretKey: randomBytes(24).toString("base64url"),
              provisionedAt: null,
            },
          })
        }

        const operation = await tx.operation.create({
          data: {
            title: strings.operations.storage.title(replicaNamespace),
            description: strings.operations.storage.description(replicaNamespace),
            type: OperationType.PROVISION_STORAGE_BUCKET,
            status: OperationStatus.PENDING,
            failureReason: null,
            failureMessage: null,
            callbackEndpoint: null,
            resolvedAt: null,
            storageBucketId: storageBucket.id,
          },
        })

        await startProvisioningWorkflow(temporalClient, "storage-bucket", operation.id)

        return {
          kind: "operation" as const,
          value: operation,
        }
      })

      if (payload.kind === "result") {
        return {
          credentials: {
            case: "result",
            value: payload.value,
          },
        }
      }

      return {
        credentials: {
          case: "operation",
          value: await operationService.toApiOperation(payload.value.id),
        },
      }
    },
  }

  return service
}

function buildStorageAccessKey() {
  return randomBytes(10).toString("hex")
}

function buildPostgresCredentials(
  postgresDatabase: PostgresDatabase,
  adminConfig: PostgresAdminConfig,
) {
  return {
    host: adminConfig.host,
    port: adminConfig.port,
    database: postgresDatabase.database,
    username: postgresDatabase.database,
    password: postgresDatabase.password,
  }
}

function buildTemporalCredentials(temporalNamespace: TemporalNamespace) {
  return {
    address: `${TEMPORAL_FRONTEND_SERVICE_NAME}.${getReplicaNamespace()}.svc.cluster.local:${TEMPORAL_FRONTEND_PORT}`,
    namespace: temporalNamespace.namespace,
  }
}

function buildStorageCredentials(storageBucket: StorageBucket, namespace: string) {
  return {
    endpoint: `${MINIO_SERVICE_NAME}.${namespace}.svc.cluster.local:${MINIO_SERVICE_PORT}`,
    bucket: storageBucket.bucket,
    accessKey: storageBucket.accessKey,
    secretKey: storageBucket.secretKey,
  }
}

async function startProvisioningWorkflow(
  temporalClient: Client,
  kind: "database" | "temporal-namespace" | "storage-bucket",
  operationId: number,
): Promise<void> {
  const workflowId = String(operationId)

  try {
    const workflowType =
      kind === "database"
        ? "provisionPostgresDatabaseWorkflow"
        : kind === "temporal-namespace"
          ? "provisionTemporalNamespaceWorkflow"
          : "provisionStorageBucketWorkflow"

    await temporalClient.workflow.start(workflowType, {
      args: [operationId],
      workflowId,
      taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
    })

    return
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      return
    }

    if (error instanceof Error) {
      throw new ConnectError(error.message, Code.Internal)
    }

    throw new ConnectError("Failed to schedule provisioning workflow", Code.Internal)
  }
}
