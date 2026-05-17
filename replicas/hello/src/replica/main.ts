import type { ConnectRouter } from "@connectrpc/connect"
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { PingService } from "@reside/api/common/ping.v1"
import { CommandHandlerService } from "@reside/api/interaction/command.v1"
import {
  createCommandHandlerService,
  createInteractionActivities,
  createPingService,
  createServer,
  logger,
  startServer,
  startTemporalWorker,
} from "@reside/common"
import { createServices } from "../shared"

const services = await createServices()

const server = await createServer(services)

await server.register(fastifyConnectPlugin, {
  routes(router: ConnectRouter) {
    router.service(CommandHandlerService, createCommandHandlerService(services.temporalClient))
    router.service(PingService, createPingService())
  },
})

await startServer(server)

await startTemporalWorker({
  services,
  activities: {
    ...createInteractionActivities(
      services.notificationService,
      services.interactionOperationService,
    ),
  },
})

logger.info("hello replica started")
