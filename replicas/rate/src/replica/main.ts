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
  setupEncryption,
  setupLanguageSubsystem,
  startServer,
  startTemporalWorker,
} from "@reside/common"
import { strings } from "../locale"
import { createServices } from "../shared"
import { createRateActivities } from "./activities"
import { createGetRateTool } from "./nls"

const services = await createServices()

const server = await createServer(services)

await setupEncryption({ services, server })

await server.register(fastifyConnectPlugin, {
  routes(router: ConnectRouter) {
    router.service(CommandHandlerService, createCommandHandlerService(services.temporalClient))
    router.service(PingService, createPingService())
  },
})

await setupLanguageSubsystem({
  services,
  server,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
  instructions:
    "Help users get and understand Central Bank key rate information. " +
    "Use get_rate for current key rate requests. " +
    "Explain rate changes briefly and say clearly when rate data is unavailable.",
  tools: [createGetRateTool(services)],
})

await startServer(server)

await startTemporalWorker({
  services,
  activities: {
    ...createRateActivities(services),
    ...createInteractionActivities(
      services.notificationService,
      services.interactionOperationService,
    ),
  },
})

logger.info("rate replica started")
