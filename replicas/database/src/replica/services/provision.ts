import type {
  GetPostgresDatabaseCredentialsResponse,
  GetTemporalNamespaceCredentialsResponse,
  PostgresDatabaseCredentials,
  ProvisionServiceImplementation,
  TemporalNamespaceCredentials,
} from "@reside/api/database/provision.v1"
import type { Empty } from "@reside/api/google/protobuf/empty"
import type { Client } from "@temporalio/client"
import type { CallContext } from "nice-grpc"
import type { PostgresDatabase, PrismaClient, TemporalNamespace } from "../../database"
import { randomBytes } from "node:crypto"
import { status } from "@grpc/grpc-js"
import { authenticateReplica, getReplicaNamespace } from "@reside/common"
import { WorkflowExecutionAlreadyStartedError, WorkflowIdReusePolicy } from "@temporalio/client"
import { ServerError } from "nice-grpc"
import { OperationStatus, OperationType } from "../../database"
import { strings } from "../../locale"
import {
  buildReplicaDatabaseName,
  type DatabaseOperationService,
  type PostgresAdminConfig,
  TEMPORAL_FRONTEND_PORT,
  TEMPORAL_FRONTEND_SERVICE_NAME,
} from "../../shared"

export function createProvisionService(
  prisma: PrismaClient,
  adminConfig: PostgresAdminConfig,
  temporalClient: Client,
  operationService: DatabaseOperationService,
) {
  const service: ProvisionServiceImplementation = {
    async getPostgresDatabaseCredentials(
      _request: Empty,
      context: CallContext,
    ): Promise<GetPostgresDatabaseCredentialsResponse> {
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
            $case: "result",
            value: payload.value,
          },
        }
      }

      return {
        credentials: {
          $case: "operation",
          value: await operationService.toApiOperation(payload.value.id),
        },
      }
    },

    async getTemporalNamespaceCredentials(
      _request: Empty,
      context: CallContext,
    ): Promise<GetTemporalNamespaceCredentialsResponse> {
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
            $case: "result",
            value: payload.value,
          },
        }
      }

      return {
        credentials: {
          $case: "operation",
          value: await operationService.toApiOperation(payload.value.id),
        },
      }
    },
  }

  return service
}

function buildPostgresCredentials(
  postgresDatabase: PostgresDatabase,
  adminConfig: PostgresAdminConfig,
): PostgresDatabaseCredentials {
  return {
    host: adminConfig.host,
    port: adminConfig.port,
    database: postgresDatabase.database,
    username: postgresDatabase.database,
    password: postgresDatabase.password,
  }
}

function buildTemporalCredentials(
  temporalNamespace: TemporalNamespace,
): TemporalNamespaceCredentials {
  return {
    address: `${TEMPORAL_FRONTEND_SERVICE_NAME}.${getReplicaNamespace()}.svc.cluster.local:${TEMPORAL_FRONTEND_PORT}`,
    namespace: temporalNamespace.namespace,
  }
}

async function startProvisioningWorkflow(
  temporalClient: Client,
  kind: "database" | "temporal-namespace",
  operationId: number,
): Promise<void> {
  const workflowId = String(operationId)

  try {
    const workflowType =
      kind === "database"
        ? "provisionPostgresDatabaseWorkflow"
        : "provisionTemporalNamespaceWorkflow"

    await temporalClient.workflow.start(workflowType, {
      args: [operationId],
      workflowId,
      taskQueue: getReplicaNamespace(),
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
    })

    return
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      return
    }

    if (error instanceof Error) {
      throw new ServerError(status.INTERNAL, error.message)
    }

    throw new ServerError(status.INTERNAL, "Failed to schedule provisioning workflow")
  }
}
