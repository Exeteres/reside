import { create } from "@bufbuild/protobuf"
import { CoreV1Api } from "@kubernetes/client-node"
import { OperationService } from "@reside/api/common/operation.v1"
import { GatewayService } from "@reside/api/infra/gateway.v1"
import { ObservabilityService } from "@reside/api/infra/observability.v1"
import { GetOpenTelemetryCredentialsResponseSchema } from "@reside/api/infra/observability.v1_pb"
import { ProvisionService } from "@reside/api/infra/provision.v1"
import { TimerService } from "@reside/api/infra/timer.v1"
import { VaultService } from "@reside/api/infra/vault.v1"
import {
  createChannels,
  createClient,
  createCommonServices,
  createGenericOperationService,
  createPostgresPoolFromCredentials,
  createTemporalClient,
  getReplicaNamespace,
  kubeConfig,
  setupTelemetry,
} from "@reside/common"
import { infraReplica } from "@reside/registry"
import { PrismaClient } from "../database"
import { loadMinioAdminConfig } from "./minio/config"
import { getOpenTelemetryCredentials } from "./observability"
import { resolveOperationResult } from "./operation"
import { loadPostgresAdminConfig } from "./postgres/config"
import { buildReplicaDatabaseName } from "./postgres/provision"
import { createReplicaDatabaseOptions } from "./requirements"
import { loadVaultConfig } from "./vault"

export async function createServices() {
  const services = await createCommonServices(infraReplica.endpoints)
  const channels = await createChannels({
    ...infraReplica.endpoints,
    infra: infraReplica.endpoint,
  })

  const { tracerProvider } = await setupTelemetry({
    getOpenTelemetryCredentials: async () => {
      return create(GetOpenTelemetryCredentialsResponseSchema, {
        result: getOpenTelemetryCredentials(),
      })
    },
  })

  const adminConfig = await loadPostgresAdminConfig()
  const minioAdminConfig = await loadMinioAdminConfig(
    kubeConfig.makeApiClient(CoreV1Api),
    getReplicaNamespace(),
  )
  const vaultConfig = await loadVaultConfig(
    kubeConfig.makeApiClient(CoreV1Api),
    getReplicaNamespace(),
  )
  const { pool: adminPool } = createPostgresPoolFromCredentials(adminConfig)

  const replicaDatabase = buildReplicaDatabaseName(getReplicaNamespace())
  const { pool, adapter } = createPostgresPoolFromCredentials({
    ...adminConfig,
    database: replicaDatabase,
  })

  const prisma = new PrismaClient({ adapter })
  const temporalClient = await createTemporalClient(createReplicaDatabaseOptions())

  const operationService = createGenericOperationService({
    prisma,
    temporalClient,
    getResult: operationId => resolveOperationResult(prisma, operationId),
  })

  return {
    ...services,
    provisionService: createClient(ProvisionService, channels.self),
    observabilityService: createClient(ObservabilityService, channels.self),
    gatewayService: createClient(GatewayService, channels.self),
    timerService: createClient(TimerService, channels.self),
    vaultService: createClient(VaultService, channels.self),
    infraOperationService: createClient(OperationService, channels.self),
    tracerProvider,
    adminConfig,
    minioAdminConfig,
    vaultConfig,
    adminPool,
    pool,
    prisma,
    temporalClient,
    operationService,
  }
}
