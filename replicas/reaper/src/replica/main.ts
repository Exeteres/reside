import type { ConnectRouter } from "@connectrpc/connect"
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { OperationSubscriptionService } from "@reside/api/common/operation.v1"
import { PingService } from "@reside/api/common/ping.v1"
import { CommandHandlerService } from "@reside/api/interaction/command.v1"
import { DefinitionService } from "@reside/api/reaper/definition.v1"
import {
  createCommandHandlerService,
  createInteractionActivities,
  createOperationSubscriptionService,
  createPingService,
  createServer,
  logger,
  setupEncryption,
  startServer,
  startTemporalWorker,
} from "@reside/common"
import { createServices } from "../shared"
import { createReaperActivities } from "./activities"
import { createDefinitionService } from "./services"

const services = await createServices()

const server = await createServer(services)

await setupEncryption({ services, server })

await server.register(fastifyConnectPlugin, {
  routes(router: ConnectRouter) {
    router.service(
      DefinitionService,
      createDefinitionService({
        prisma: services.prisma,
        authzService: services.authzService,
      }),
    )
    router.service(CommandHandlerService, createCommandHandlerService(services.temporalClient))
    router.service(
      OperationSubscriptionService,
      createOperationSubscriptionService(services.temporalClient),
    )
    router.service(PingService, createPingService())
  },
})

await startServer(server)

await startTemporalWorker({
  services,
  activities: {
    ...createReaperActivities(services),
    ...createInteractionActivities(
      services.notificationService,
      services.interactionOperationService,
    ),
  },
})

logger.info("reaper replica started")
