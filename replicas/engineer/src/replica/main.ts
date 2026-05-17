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
  startServer,
  startTemporalWorker,
} from "@reside/common"
import { createServices } from "../shared"
import { createCreateTaskActivities } from "./activities/task"
import { startEngineerAiRuntime } from "./ai-runtime"

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

await startServer(server)

const runtime = await startEngineerAiRuntime()
const createTaskActivities = createCreateTaskActivities({
  runtime,
  prisma: services.prisma,
  notificationService: services.notificationService,
  loadService: services.alphaLoadService,
  storageBucketService: services.storageBucketService,
})

await startTemporalWorker({
  services,
  activities: {
    ...createInteractionActivities(
      services.notificationService,
      services.interactionOperationService,
    ),
    ...createTaskActivities,
  },
})

logger.info("engineer replica server started")
