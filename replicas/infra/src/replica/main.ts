import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { OperationService } from "@reside/api/common/operation.v1"
import { PingService } from "@reside/api/common/ping.v1"
import { GatewayService } from "@reside/api/infra/gateway.v1"
import { ObservabilityService } from "@reside/api/infra/observability.v1"
import { ProvisionService } from "@reside/api/infra/provision.v1"
import { TimerService } from "@reside/api/infra/timer.v1"
import { VaultService } from "@reside/api/infra/vault.v1"
import { ReplicaReaperHandler } from "@reside/api/reaper/handler.v1"
import {
  createPingService,
  createServer,
  createSleepActivities,
  crypto,
  getReplicaNamespace,
  logger,
  setupEncryption,
  setupLanguageSubsystem,
  startServer,
  startTemporalWorker,
} from "@reside/common"
import { strings } from "../locale"
import { createServices, normalizeBucketName } from "../shared"
import {
  TEMPORAL_FRONTEND_PORT,
  TEMPORAL_FRONTEND_SERVICE_NAME,
} from "../shared/temporal/constants"
import { createDatabaseActivities } from "./activities"
import { createGatewayService } from "./services/gateway"
import { createObservabilityService } from "./services/observability"
import { createProvisionService } from "./services/provision"
import { createReaperService } from "./services/reaper"
import { createTimerService } from "./services/timer"
import { createVaultService } from "./services/vault"

const services = await createServices()

const server = await createServer(services)

await setupEncryption({ services, server })

const observabilityService = createObservabilityService()

await server.register(fastifyConnectPlugin, {
  routes(router) {
    router.service(ProvisionService, createProvisionService(services))
    router.service(GatewayService, createGatewayService(services))
    router.service(ObservabilityService, observabilityService)
    router.service(TimerService, createTimerService(services))
    router.service(VaultService, createVaultService(services))
    router.service(ReplicaReaperHandler, createReaperService({ ...services, crypto }))
    router.service(PingService, createPingService())
    router.service(OperationService, services.operationService.implementation)
  },
})

await setupLanguageSubsystem({
  services,
  server,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
  instructions:
    "Help users understand infrastructure resources, gateways, timers, Vault, databases, and storage provisioning. " +
    "Use available data before stating current endpoints or resource state. " +
    "Be explicit about operational risk when discussing infrastructure changes. " +
    "Never expose secret values.",
  storageCredentials: {
    endpoint: services.minioAdminConfig.endpoint,
    bucket: normalizeBucketName(getReplicaNamespace()),
    accessKey: services.minioAdminConfig.username,
    secretKey: services.minioAdminConfig.password,
  },
})

await startServer(server)

await startTemporalWorker({
  services,
  temporalCredentials: {
    address: `${TEMPORAL_FRONTEND_SERVICE_NAME}.${getReplicaNamespace()}.svc.cluster.local:${TEMPORAL_FRONTEND_PORT}`,
    namespace: getReplicaNamespace(),
  },
  createActivities: ({ connection }) => {
    return {
      ...services.operationService.activities,
      ...createSleepActivities(services.timerService),
      ...createDatabaseActivities({
        ...services,
        workflowService: connection.workflowService,
      }),
    }
  },
})

logger.info("infra replica started")
