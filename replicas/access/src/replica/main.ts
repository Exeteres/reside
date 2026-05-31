import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { AuthzService } from "@reside/api/access/authz.v1"
import { BindingService } from "@reside/api/access/binding.v1"
import { DefinitionService } from "@reside/api/access/definition.v1"
import { PermissionRequestService } from "@reside/api/access/request.v1"
import { OperationService, OperationSubscriptionService } from "@reside/api/common/operation.v1"
import { PingService } from "@reside/api/common/ping.v1"
import { SubjectService } from "@reside/api/common/subject.v1"
import {
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
import { createAccessActivities } from "./activities"
import { createAuthzService } from "./services/authz"
import { createBindingService } from "./services/binding"
import { createDefinitionService } from "./services/definition"
import { createPermissionRequestService } from "./services/request"
import { createSubjectService } from "./services/subject"

const services = await createServices()

const server = await createServer(services)

await server.register(fastifyConnectPlugin, {
  routes(router) {
    router.service(AuthzService, createAuthzService(services))
    router.service(BindingService, createBindingService(services))
    router.service(DefinitionService, createDefinitionService(services))
    router.service(PermissionRequestService, createPermissionRequestService(services))
    router.service(SubjectService, createSubjectService(services))
    router.service(PingService, createPingService())
    router.service(OperationService, services.operationService.implementation)
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
  mission: "Guard realms, permissions, and approval flows.",
})

await startServer(server)

await startTemporalWorker({
  services,
  activities: {
    ...services.operationService.activities,
    ...createAccessActivities(services),
  },
})

logger.info("access replica started")
