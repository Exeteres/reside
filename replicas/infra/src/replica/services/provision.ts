import type { ProvisionServiceImplementation } from "@reside/api/infra/provision.v1"
import type { GenericOperationService } from "@reside/common"
import type { Client } from "@temporalio/client"
import type { Operation, PrismaClient } from "../../database"
import type { MinioAdminConfig, PostgresAdminConfig } from "../../shared"
import { authenticateReplica } from "@reside/common"
import {
  resolvePostgresCredentialsPayload,
  resolveStorageBucketCredentialsPayload,
  resolveTemporalNamespaceCredentialsPayload,
  toProvisionApiOperation,
} from "../business/provision"

export function createProvisionService({
  prisma,
  adminConfig,
  minioAdminConfig,
  temporalClient,
  operationService,
}: {
  prisma: PrismaClient
  adminConfig: PostgresAdminConfig
  minioAdminConfig: MinioAdminConfig
  temporalClient: Client
  operationService: GenericOperationService<Operation>
}): ProvisionServiceImplementation {
  return {
    async getPostgresDatabaseCredentials(_request, context) {
      const identity = await authenticateReplica(context)
      const replicaNamespace = `replica-${identity.name}`

      const payload = await resolvePostgresCredentialsPayload({
        prisma,
        adminConfig,
        temporalClient,
        replicaNamespace,
      })

      return {
        credentials: await toProvisionApiOperation(payload, operationService),
      }
    },

    async getTemporalNamespaceCredentials(_request, context) {
      const identity = await authenticateReplica(context)
      const replicaNamespace = `replica-${identity.name}`

      const payload = await resolveTemporalNamespaceCredentialsPayload({
        prisma,
        temporalClient,
        replicaNamespace,
      })

      return {
        credentials: await toProvisionApiOperation(payload, operationService),
      }
    },

    async getStorageBucketCredentials(_request, context) {
      const identity = await authenticateReplica(context)
      const replicaNamespace = `replica-${identity.name}`

      const payload = await resolveStorageBucketCredentialsPayload({
        prisma,
        temporalClient,
        replicaNamespace,
        endpoint: minioAdminConfig.endpoint,
      })

      return {
        credentials: await toProvisionApiOperation(payload, operationService),
      }
    },
  }
}
