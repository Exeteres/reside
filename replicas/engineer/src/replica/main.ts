import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { OperationSubscriptionService } from "@reside/api/common/operation.v1"
import { PingService } from "@reside/api/common/ping.v1"
import { CommandHandlerService } from "@reside/api/interaction/command.v1"
import {
  createCommandHandlerService,
  createInteractionActivities,
  createOperationSubscriptionService,
  createPingService,
  createServer,
  logger,
  setupLanguageSubsystem,
  startServer,
  startTemporalWorker,
} from "@reside/common"
import { strings } from "../locale"
import { createServices } from "../shared"
import { createTaskActivities } from "./activities"
import { startEngineerAiRuntime } from "./business"
import { createCreateTaskTool } from "./nls"

const services = await createServices()

const server = await createServer(services)

await server.register(fastifyConnectPlugin, {
  routes(router) {
    router.service(CommandHandlerService, createCommandHandlerService(services.temporalClient))
    router.service(PingService, createPingService())
    router.service(
      OperationSubscriptionService,
      createOperationSubscriptionService(services.temporalClient),
    )
  },
})

await setupLanguageSubsystem({
  services,
  server,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
  mission: "Implement tasks, ship code, and automate delivery.",
  tools: [
    createCreateTaskTool({
      temporalClient: services.temporalClient,
    }),
  ],
})

await startServer(server)

const runtime = await startEngineerAiRuntime()
const taskActivities = createTaskActivities({
  runtime,
  prisma: services.prisma,
  notificationService: services.notificationService,
  permissionRequestService: services.permissionRequestService,
  accessOperationService: services.accessOperationService,
  loadService: services.alphaLoadService,
  alphaOperationService: services.alphaOperationService,
  storageBucketService: services.storageBucketService,
})

await startTemporalWorker({
  services,
  activities: {
    ...createInteractionActivities(
      services.notificationService,
      services.interactionOperationService,
    ),
    ...taskActivities,
  },
})

logger.info("engineer replica server started")
