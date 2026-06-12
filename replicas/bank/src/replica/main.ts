import type { ConnectRouter } from "@connectrpc/connect"
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { PingService } from "@reside/api/common/ping.v1"
import { CommandHandlerService } from "@reside/api/interaction/command.v1"
import {
  createCommandHandlerService,
  createInteractionActivities,
  createPingService,
  createServer,
  crypto,
  logger,
  setupEncryption,
  setupLanguageSubsystem,
  startServer,
  startTemporalWorker,
} from "@reside/common"
import { strings } from "../locale"
import { createServices } from "../shared"
import { createBankActivities } from "./activities"
import { createBankTools } from "./nls"

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
    "Help users manage virtual currency ∅. Use tools for balance, history, and transfers. " +
    "Never expose plaintext personal data in tool results.",
  tools: createBankTools({ crypto, prisma: services.prisma }),
})

await startServer(server)

await startTemporalWorker({
  services,
  activities: {
    ...createBankActivities({ crypto, prisma: services.prisma }),
    ...createInteractionActivities(
      services.notificationService,
      services.interactionOperationService,
    ),
  },
})

logger.info("bank replica started")
