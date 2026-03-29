import { startService } from "@reside/api"
import { CommandHandlerServiceDefinition } from "@reside/api/interaction/command.v1"
import {
  createCommandHandlerService,
  createInteractionActivities,
  logger,
  runTemporalWorker,
} from "@reside/common"
import { createServer } from "nice-grpc"
import { createServices } from "../shared"
import { createRateActivities } from "./activities/rate"

const {
  temporalClient,
  databaseProvisionService,
  databaseOperationService,
  interactionNotificationService,
  interactionOperationService,
} = await createServices()

const server = createServer()

server.add(CommandHandlerServiceDefinition, createCommandHandlerService(temporalClient))

await startService(server)

await runTemporalWorker({
  provisionService: databaseProvisionService,
  operationService: databaseOperationService,
  activities: {
    ...createInteractionActivities({
      notificationService: interactionNotificationService,
      operationService: interactionOperationService,
    }),
    ...createRateActivities(),
  },
})

logger.info("rate replica server started")
