import type { ConnectRouter } from "@connectrpc/connect"
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { OperationSubscriptionService } from "@reside/api/common/operation.v1"
import { PingService } from "@reside/api/common/ping.v1"
import { CommandHandlerService } from "@reside/api/interaction/command.v1"
import {
  createCommandHandlerService,
  createInteractionActivities,
  createOperationActivities,
  createOperationSubscriptionService,
  createPingService,
  createServer,
  createSleepActivities,
  logger,
  setupEncryption,
  setupLanguageSubsystem,
  startServer,
  startTemporalWorker,
} from "@reside/common"
import { strings } from "../locale"
import { createServices } from "../shared"
import { createCasinoActivities } from "./activities"
import { casinoTools } from "./nls"

const services = await createServices()

const server = await createServer(services)

await setupEncryption({ services, server })

await server.register(fastifyConnectPlugin, {
  routes(router: ConnectRouter) {
    router.service(CommandHandlerService, createCommandHandlerService(services.temporalClient))
    router.service(
      OperationSubscriptionService,
      createOperationSubscriptionService(services.temporalClient),
    )
    router.service(PingService, createPingService())
  },
})

await setupLanguageSubsystem({
  services,
  server,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
  instructions:
    "Help users make dice bets through the casino replica. " +
    "Use get_casino_rules for questions about supported bet syntax, default sides, dice flow, and payout rules. " +
    "Do not promise a win or expose internal workflow, bank, or database implementation details.",
  tools: casinoTools,
})

await startServer(server)

await startTemporalWorker({
  services,
  activities: {
    ...createCasinoActivities(services),
    ...createInteractionActivities(
      services.notificationService,
      services.interactionOperationService,
    ),
    subscribeToBankOperationCompletion: createOperationActivities(services.bankOperationService)
      .subscribeToOperationCompletion,
    ...createSleepActivities(services.timerService),
  },
})

logger.info("casino replica started")
