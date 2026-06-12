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
import { createExampleActivities } from "./activities"
import { createExampleTools } from "./nls"

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
    "Help users understand the example replica template. " +
    "Use get_example_status for status requests. " +
    "Do not expose decrypted note content or internal storage object names.",
  tools: createExampleTools(services),
})

await startServer(server)

await startTemporalWorker({
  services,
  activities: {
    ...createExampleActivities(services),
    ...createInteractionActivities(
      services.notificationService,
      services.interactionOperationService,
    ),
  },
})

logger.info("example replica started")
