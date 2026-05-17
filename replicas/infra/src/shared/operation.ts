import { Code, ConnectError } from "@connectrpc/connect"
import { getReplicaNamespace } from "@reside/common"
import { OperationType, type PrismaClient } from "../database"
import { MINIO_SERVICE_NAME, MINIO_SERVICE_PORT } from "./minio/constants"
import { POSTGRES_SERVICE_NAME, POSTGRES_SERVICE_PORT } from "./postgres/constants"
import { TEMPORAL_FRONTEND_PORT, TEMPORAL_FRONTEND_SERVICE_NAME } from "./temporal/constants"

export async function resolveOperationResult(
  prisma: PrismaClient,
  operationId: number,
): Promise<unknown> {
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
    throw new ConnectError(`Operation "${operationId}" was not found`, Code.NotFound)
  }

  const namespace = getReplicaNamespace()

  if (operation.type === OperationType.PROVISION_POSTGRES_DATABASE) {
    if (operation.postgresDatabase === null) {
      throw new ConnectError(
        `Operation "${operationId}" is missing PostgreSQL database relation`,
        Code.Internal,
      )
    }

    return {
      host: `${POSTGRES_SERVICE_NAME}.${namespace}.svc.cluster.local`,
      port: POSTGRES_SERVICE_PORT,
      database: operation.postgresDatabase.database,
      username: operation.postgresDatabase.database,
      password: operation.postgresDatabase.password,
    }
  }

  if (operation.type === OperationType.PROVISION_TEMPORAL_NAMESPACE) {
    if (operation.temporalNamespace === null) {
      throw new ConnectError(
        `Operation "${operationId}" is missing Temporal namespace relation`,
        Code.Internal,
      )
    }

    return {
      address: `${TEMPORAL_FRONTEND_SERVICE_NAME}.${namespace}.svc.cluster.local:${TEMPORAL_FRONTEND_PORT}`,
      namespace: operation.temporalNamespace.namespace,
    }
  }

  if (operation.type === OperationType.PROVISION_STORAGE_BUCKET) {
    if (operation.storageBucket === null) {
      throw new ConnectError(
        `Operation "${operationId}" is missing storage bucket relation`,
        Code.Internal,
      )
    }

    return {
      endpoint: `${MINIO_SERVICE_NAME}.${namespace}.svc.cluster.local:${MINIO_SERVICE_PORT}`,
      bucket: operation.storageBucket.bucket,
      accessKey: operation.storageBucket.accessKey,
      secretKey: operation.storageBucket.secretKey,
    }
  }

  if (operation.type === OperationType.ENSURE_GATEWAY) {
    if (operation.gateway === null) {
      throw new ConnectError(
        `Operation "${operationId}" is missing gateway relation`,
        Code.Internal,
      )
    }

    const clusterDomain = process.env.RESIDE_CLUSTER_DOMAIN?.trim()
    const endpoint =
      clusterDomain && clusterDomain.length > 0
        ? `${operation.gateway.name}.${clusterDomain}`
        : operation.gateway.name

    return {
      name: operation.gateway.name,
      endpoint,
    }
  }

  throw new ConnectError(
    `Unsupported operation type for result resolution: "${operation.type}"`,
    Code.Internal,
  )
}
