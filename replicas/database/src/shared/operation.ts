import { status } from "@grpc/grpc-js"
import { getReplicaNamespace } from "@reside/common"
import { ServerError } from "nice-grpc"
import { OperationType, type PrismaClient } from "../database"
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
    },
  })

  if (operation === null) {
    throw new ServerError(status.NOT_FOUND, `Operation "${operationId}" was not found`)
  }

  const namespace = getReplicaNamespace()

  if (operation.type === OperationType.PROVISION_POSTGRES_DATABASE) {
    if (operation.postgresDatabase === null) {
      throw new ServerError(
        status.INTERNAL,
        `Operation "${operationId}" is missing PostgreSQL database relation`,
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
      throw new ServerError(
        status.INTERNAL,
        `Operation "${operationId}" is missing Temporal namespace relation`,
      )
    }

    return {
      address: `${TEMPORAL_FRONTEND_SERVICE_NAME}.${namespace}.svc.cluster.local:${TEMPORAL_FRONTEND_PORT}`,
      namespace: operation.temporalNamespace.namespace,
    }
  }

  throw new ServerError(
    status.INTERNAL,
    `Unsupported operation type for result resolution: "${operation.type}"`,
  )
}
