import { Code, ConnectError } from "@connectrpc/connect"
import { CoreV1Api } from "@kubernetes/client-node"
import { getReplicaNamespace, kubeConfig } from "@reside/common"
import { OperationType, type PrismaClient } from "../database"
import { loadInfraGatewayConfig, resolveGatewayFqdn } from "./gateway"
import { loadMinioAdminConfig } from "./minio/config"
import { loadPostgresAdminConfig } from "./postgres/config"
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

  if (
    operation.type === OperationType.PROVISION_POSTGRES_DATABASE ||
    operation.type === OperationType.PROVISION_TEMPORARY_POSTGRES_DATABASE
  ) {
    if (operation.postgresDatabase === null) {
      throw new ConnectError(
        `Operation "${operationId}" is missing PostgreSQL database relation`,
        Code.Internal,
      )
    }

    const adminConfig = await loadPostgresAdminConfig()

    return {
      host: adminConfig.host,
      port: adminConfig.port,
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

    const coreApi = kubeConfig.makeApiClient(CoreV1Api)
    const minioAdminConfig = await loadMinioAdminConfig(coreApi, namespace)

    return {
      endpoint: minioAdminConfig.endpoint,
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

    const coreApi = kubeConfig.makeApiClient(CoreV1Api)
    const infraGatewayConfig = await loadInfraGatewayConfig(coreApi, namespace)
    const endpoint = resolveGatewayFqdn(operation.gateway.name, infraGatewayConfig.clusterDomain)

    return {
      endpoint,
    }
  }

  if (
    operation.type === OperationType.DELETE_POSTGRES_DATABASE ||
    operation.type === OperationType.DELETE_TEMPORAL_NAMESPACE ||
    operation.type === OperationType.DELETE_GATEWAY
  ) {
    return {}
  }

  throw new ConnectError(
    `Unsupported operation type for result resolution: "${operation.type}"`,
    Code.Internal,
  )
}
