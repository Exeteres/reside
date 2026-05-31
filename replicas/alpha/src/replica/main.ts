import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { DiscoveryService } from "@reside/api/alpha/discovery.v1"
import { LoadService } from "@reside/api/alpha/load.v1"
import { RegistrationService } from "@reside/api/alpha/registration.v1"
import { ReplicaService } from "@reside/api/alpha/replica.v1"
import { OperationService, OperationSubscriptionService } from "@reside/api/common/operation.v1"
import { PingService } from "@reside/api/common/ping.v1"
import { SubjectService } from "@reside/api/common/subject.v1"
import { CommandHandlerService } from "@reside/api/interaction/command.v1"
import {
  createCommandHandlerService,
  createInteractionActivities,
  createOperationSubscriptionService,
  createPingService,
  createServer,
  createSleepActivities,
  logger,
  setupLanguageSubsystem,
  startServer,
  startTemporalWorker,
} from "@reside/common"
import { strings } from "../locale"
import { createServices } from "../shared"
import { createRegistrationActivities, createReplicaManagementActivities } from "./activities"
import { setupReplicaCrdReconciliation } from "./business/replica-crd"
import { createAlphaNlsTools } from "./nls"
import { createDiscoveryService } from "./services/discovery"
import { createLoadService } from "./services/load"
import { createRegistrationService } from "./services/registration"
import { createReplicaService } from "./services/replica"
import { createSubjectService } from "./services/subject"

const services = await createServices()

const server = await createServer(services)

await server.register(fastifyConnectPlugin, {
  routes(router) {
    router.service(LoadService, createLoadService(services))
    router.service(RegistrationService, createRegistrationService(services))
    router.service(DiscoveryService, createDiscoveryService(services))
    router.service(ReplicaService, createReplicaService(services))
    router.service(OperationService, services.operationService.implementation)
    router.service(
      OperationSubscriptionService,
      createOperationSubscriptionService(services.temporalClient),
    )
    router.service(PingService, createPingService())
    router.service(SubjectService, createSubjectService(services))
    router.service(CommandHandlerService, createCommandHandlerService(services.temporalClient))
  },
})

await setupLanguageSubsystem({
  services,
  server,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
  mission: "Register replicas and resolve topology endpoints.",
  tools: createAlphaNlsTools({
    temporalClient: services.temporalClient,
    prisma: services.prisma,
  }),
})

await startServer(server)

setupReplicaCrdReconciliation(services.prisma)

await startTemporalWorker({
  services,
  activities: {
    ...services.operationService.activities,
    ...createRegistrationActivities(services),
    ...createReplicaManagementActivities(services),
    ...createInteractionActivities(
      services.notificationService,
      services.interactionOperationService,
    ),
    ...createSleepActivities(services.timerService),
  },
})

logger.info("alpha replica started")
