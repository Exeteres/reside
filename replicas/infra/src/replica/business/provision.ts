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
import { Code, ConnectError } from "@connectrpc/connect"
import { DEFAULT_TEMPORAL_TASK_QUEUE, getReplicaNamespace } from "@reside/common"
import { WorkflowExecutionAlreadyStartedError, WorkflowIdReusePolicy } from "@temporalio/client"
import { OperationStatus, OperationType } from "../../database"
import { strings } from "../../locale"
import {
  buildReplicaDatabaseName,
  normalizeBucketName,
  type PostgresAdminConfig,
  TEMPORAL_FRONTEND_PORT,
  TEMPORAL_FRONTEND_SERVICE_NAME,
} from "../../shared"

export type PostgresCredentials = {
  host: string
  port: number
  database: string
  username: string
  password: string
}

export type TemporalCredentials = {
  address: string
  namespace: string
}

export type StorageCredentials = {
  endpoint: string
  bucket: string
  accessKey: string
  secretKey: string
}

export type ProvisioningPayload<T> =
  | {
      kind: "result"
      value: T
    }
  | {
      kind: "operation"
      value: Operation
    }

export async function resolvePostgresCredentialsPayload({
  prisma,
  adminConfig,
  temporalClient,
  replicaNamespace,
}: {
  prisma: PrismaClient
  adminConfig: PostgresAdminConfig
  temporalClient: Client
  replicaNamespace: string
}): Promise<ProvisioningPayload<PostgresCredentials>> {
  return await prisma.$transaction(async tx => {
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
          kind: "operation",
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
          kind: "result",
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
      kind: "operation",
      value: operation,
    }
  })
}

export async function resolveTemporalNamespaceCredentialsPayload({
  prisma,
  temporalClient,
  replicaNamespace,
}: {
  prisma: PrismaClient
  temporalClient: Client
  replicaNamespace: string
}): Promise<ProvisioningPayload<TemporalCredentials>> {
  return await prisma.$transaction(async tx => {
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
          kind: "operation",
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
          kind: "result",
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
      kind: "operation",
      value: operation,
    }
  })
}

export async function resolveStorageBucketCredentialsPayload({
  prisma,
  temporalClient,
  replicaNamespace,
  endpoint,
}: {
  prisma: PrismaClient
  temporalClient: Client
  replicaNamespace: string
  endpoint: string
}): Promise<ProvisioningPayload<StorageCredentials>> {
  return await prisma.$transaction(async tx => {
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
          kind: "operation",
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
          kind: "result",
          value: buildStorageCredentials(storageBucket, endpoint),
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
      kind: "operation",
      value: operation,
    }
  })
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

function buildStorageCredentials(storageBucket: StorageBucket, endpoint: string) {
  return {
    endpoint,
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
  const workflowId = buildProvisioningWorkflowId(kind, operationId)

  try {
    const workflowType =
      kind === "database"
        ? "provisionPostgresDatabaseWorkflow"
        : kind === "temporal-namespace"
          ? "provisionTemporalNamespaceWorkflow"
          : "provisionStorageBucketWorkflow"

    await temporalClient.workflow.start(workflowType, {
      args: [{ operationId }],
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

function buildProvisioningWorkflowId(
  kind: "database" | "temporal-namespace" | "storage-bucket",
  operationId: number,
) {
  return `provision-${kind}-${operationId}`
}

export async function toProvisionApiOperation<T>(
  payload: ProvisioningPayload<T>,
  operationService: GenericOperationService<Operation>,
) {
  if (payload.kind === "result") {
    return {
      case: "result" as const,
      value: payload.value,
    }
  }

  return {
    case: "operation" as const,
    value: await operationService.toApiOperation(payload.value.id),
  }
}
