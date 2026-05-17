import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { OperationService } from "@reside/api/common/operation.v1"
import { PingService } from "@reside/api/common/ping.v1"
import { GatewayService } from "@reside/api/infra/gateway.v1"
import { ObservabilityService } from "@reside/api/infra/observability.v1"
import { ProvisionService } from "@reside/api/infra/provision.v1"
import { TimerService } from "@reside/api/infra/timer.v1"
import {
  createPingService,
  createServer,
  logger,
  startServer,
  startTemporalWorker,
} from "@reside/common"
import { createServices } from "../shared"
import { createDatabaseActivities } from "./activities"
import { createGatewayService } from "./services/gateway"
import { createObservabilityService } from "./services/observability"
import { createProvisionService } from "./services/provision"
import { createTimerService } from "./services/timer"

const services = await createServices()

const server = await createServer(services)

const observabilityService = createObservabilityService()

await server.register(fastifyConnectPlugin, {
  routes(router) {
    router.service(ProvisionService, createProvisionService(services))
    router.service(GatewayService, createGatewayService(services))
    router.service(ObservabilityService, observabilityService)
    router.service(TimerService, createTimerService(services))
    router.service(PingService, createPingService())
    router.service(OperationService, services.operationService.implementation)
  },
})

await startServer(server)

await startTemporalWorker({
  services,
  createActivities: ({ connection }) => {
    return {
      ...services.operationService.activities,
      ...createDatabaseActivities(
        services.prisma,
        services.adminPool,
        services.adminConfig,
        connection.workflowService,
        services.operationService,
      ),
    }
  },
})

logger.info("infra replica started")
