import { startService } from "@reside/api"
import { OperationSubscriptionServiceDefinition } from "@reside/api/common/operation.v1"
import { CommandHandlerServiceDefinition } from "@reside/api/interaction/command.v1"
import {
  createCommandHandlerService,
  createInteractionActivities,
  createOperationSubscriptionService,
  logger,
  runTemporalWorker,
} from "@reside/common"
import { createServer } from "nice-grpc"
import { createServices } from "../shared"
import { createCreateTaskActivities } from "./activities/task"
import { startEngineerAiRuntime } from "./ai-runtime"

const {
  prisma,
  temporalClient,
  databaseProvisionService,
  databaseOperationService,
  interactionNotificationService,
  interactionOperationService,
} = await createServices()

const server = createServer()

server.add(CommandHandlerServiceDefinition, createCommandHandlerService(temporalClient))
server.add(
  OperationSubscriptionServiceDefinition,
  createOperationSubscriptionService(temporalClient),
)

await startService(server)

const runtime = await startEngineerAiRuntime()
const createTaskActivities = createCreateTaskActivities(
  runtime,
  prisma,
  interactionNotificationService,
)

await runTemporalWorker({
  provisionService: databaseProvisionService,
  operationService: databaseOperationService,
  activities: {
    ...createInteractionActivities({
      notificationService: interactionNotificationService,
      operationService: interactionOperationService,
    }),
    ...createTaskActivities,
  },
})

logger.info("engineer replica server started")
