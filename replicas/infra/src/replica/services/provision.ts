import type { ProvisionServiceImplementation } from "@reside/api/infra/provision.v1"
import type { CommonServices, GenericOperationService } from "@reside/common"
import type { Client } from "@temporalio/client"
import type { Operation, PrismaClient } from "../../database"
import type { MinioAdminConfig, PostgresAdminConfig } from "../../shared"
import { Code, ConnectError } from "@connectrpc/connect"
import { authenticateReplica } from "@reside/common"
import { WellKnownPermissions } from "@reside/registry"
import {
  resolvePostgresCredentialsPayload,
  resolveStorageBucketCredentialsPayload,
  resolveTemporalNamespaceCredentialsPayload,
  resolveTemporaryPostgresCredentialsPayload,
  toProvisionApiOperation,
} from "../business/provision"

export function createProvisionService({
  prisma,
  adminConfig,
  minioAdminConfig,
  temporalClient,
  operationService,
  authzService,
}: CommonServices<"access"> & {
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

    async createTemporaryPostgresDatabase(_request, context) {
      const identity = await authenticateReplica(context)
      const subjectId = `replica:${identity.name}`

      const authz = await authzService.checkPermission({
        permissionName: WellKnownPermissions.INFRA_TEMPORARY_POSTGRES_DATABASE_CREATE,
        subjectId,
      })

      if (!authz.authorized) {
        throw new ConnectError(
          `Subject "${subjectId}" is not allowed to create temporary PostgreSQL databases`,
          Code.PermissionDenied,
        )
      }

      const payload = await resolveTemporaryPostgresCredentialsPayload({
        prisma,
        temporalClient,
        ownerReplicaName: identity.name,
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
