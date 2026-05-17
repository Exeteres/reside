import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { DiscoveryService } from "@reside/api/alpha/discovery.v1"
import { LoadService } from "@reside/api/alpha/load.v1"
import { RegistrationService } from "@reside/api/alpha/registration.v1"
import { OperationService } from "@reside/api/common/operation.v1"
import { PingService } from "@reside/api/common/ping.v1"
import { SubjectService } from "@reside/api/common/subject.v1"
import { CommandHandlerService } from "@reside/api/interaction/command.v1"
import {
  createCommandHandlerService,
  createInteractionActivities,
  createPingService,
  createServer,
  createSleepActivities,
  logger,
  startServer,
  startTemporalWorker,
} from "@reside/common"
import { createServices } from "../shared"
import { createRegistrationActivities } from "./activities/registration"
import { setupReplicaCrdReconciliation } from "./reconcile/replica-crd"
import { createDiscoveryService } from "./services/discovery"
import { createLoadService } from "./services/load"
import { createRegistrationService } from "./services/registration"
import { createSubjectService } from "./services/subject"

const services = await createServices()

const server = await createServer(services)

await server.register(fastifyConnectPlugin, {
  routes(router) {
    router.service(LoadService, createLoadService(services))
    router.service(RegistrationService, createRegistrationService(services))
    router.service(DiscoveryService, createDiscoveryService(services))
    router.service(OperationService, services.operationService.implementation)
    router.service(PingService, createPingService())
    router.service(SubjectService, createSubjectService(services))
    router.service(CommandHandlerService, createCommandHandlerService(services.temporalClient))
  },
})

await startServer(server)

setupReplicaCrdReconciliation(services.prisma)

await startTemporalWorker({
  services,
  activities: {
    ...services.operationService.activities,
    ...createRegistrationActivities(services.prisma, services.operationService),
    ...createInteractionActivities(
      services.notificationService,
      services.interactionOperationService,
    ),
    ...createSleepActivities(services.timerService),
  },
})

logger.info("alpha replica started")
