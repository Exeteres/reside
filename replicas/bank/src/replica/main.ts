import type { ConnectRouter } from "@connectrpc/connect"
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { BankService } from "@reside/api/bank/bank.v1"
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
import { createBankActivities } from "./activities"
import { createBankTools } from "./nls"
import { createBankService } from "./services"

const services = await createServices()
const bankService = createBankService(services)

const server = await createServer(services)

await setupEncryption({ services, server })

await server.register(fastifyConnectPlugin, {
  routes(router: ConnectRouter) {
    router.service(BankService, bankService)
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
    "Help users manage the ∅ virtual currency. " +
    "Use bank tools only for the current interaction subject from the system prompt. " +
    "Use transaction amount ECIDs exactly as returned instead of plaintext amounts. " +
    "Do not invent balances or claim that a transfer succeeded unless the tool result confirms it.",
  tools: createBankTools(services),
})

await startServer(server)

await startTemporalWorker({
  services,
  activities: {
    ...createBankActivities(services),
    ...createInteractionActivities(
      services.notificationService,
      services.interactionOperationService,
    ),
  },
})

logger.info("bank replica started")
