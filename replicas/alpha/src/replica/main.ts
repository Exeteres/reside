import { startService } from "@reside/api"
import { LoadServiceDefinition } from "@reside/api/alpha/load.v1"
import { RegistrationServiceDefinition } from "@reside/api/alpha/registration.v1"
import { OperationServiceDefinition } from "@reside/api/common/operation.v1"
import { SubjectServiceDefinition } from "@reside/api/common/subject.v1"
import { CommandHandlerServiceDefinition } from "@reside/api/interaction/command.v1"
import {
  createCommandHandlerService,
  createInteractionActivities,
  logger,
  runTemporalWorker,
} from "@reside/common"
import { createServer } from "nice-grpc"
import { createServices } from "../shared"
import { createRegistrationActivities } from "./activities/registration"
import { setupReplicaCrdReconciliation } from "./reconcile/replica-crd"
import { createLoadService } from "./services/load"
import { createRegistrationService } from "./services/registration"
import { createSubjectService } from "./services/subject"

const {
  prisma,
  alphaOperationService,
  databaseProvisionService,
  databaseOperationService,
  notificationService,
  interactionOperationService,
  accessAuthzService,
  temporalClient,
} = await createServices()

const server = createServer()

server.add(
  LoadServiceDefinition,
  createLoadService(prisma, () => accessAuthzService),
)
server.add(
  RegistrationServiceDefinition,
  createRegistrationService(prisma, temporalClient, alphaOperationService),
)
server.add(OperationServiceDefinition, alphaOperationService.implementation)
server.add(SubjectServiceDefinition, createSubjectService(prisma))
server.add(CommandHandlerServiceDefinition, createCommandHandlerService(temporalClient))

await startService(server)

await alphaOperationService.startOperationWorker({
  provisionService: databaseProvisionService,
  operationService: databaseOperationService,
})

setupReplicaCrdReconciliation(prisma)

await runTemporalWorker({
  provisionService: databaseProvisionService,
  operationService: databaseOperationService,
  activities: {
    ...createRegistrationActivities(prisma, alphaOperationService),
    ...createInteractionActivities({
      notificationService,
      operationService: interactionOperationService,
    }),
  },
})

logger.info("alpha replica server started")
