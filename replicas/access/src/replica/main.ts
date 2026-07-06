import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { AuthzService } from "@reside/api/access/authz.v1"
import { BindingService } from "@reside/api/access/binding.v1"
import { DefinitionService } from "@reside/api/access/definition.v1"
import { PermissionRequestService } from "@reside/api/access/request.v1"
import { OperationService, OperationSubscriptionService } from "@reside/api/common/operation.v1"
import { PingService } from "@reside/api/common/ping.v1"
import { SubjectService } from "@reside/api/common/subject.v1"
import { ReplicaReaperHandler } from "@reside/api/reaper/handler.v1"
import {
  createInteractionActivities,
  createOperationSubscriptionService,
  createPingService,
  createServer,
  crypto,
  logger,
  setupEncryption,
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
import { createReaperService } from "./services/reaper"
import { createPermissionRequestService } from "./services/request"
import { createSubjectService } from "./services/subject"

const services = await createServices()
const interactionActivities =
  services.notificationService !== undefined && services.interactionOperationService !== undefined
    ? createInteractionActivities(
        services.notificationService,
        services.interactionOperationService,
      )
    : {}

const server = await createServer(services)

await setupEncryption({ services, server })

await server.register(fastifyConnectPlugin, {
  routes(router) {
    router.service(AuthzService, createAuthzService(services))
    router.service(BindingService, createBindingService(services))
    router.service(DefinitionService, createDefinitionService(services))
    router.service(PermissionRequestService, createPermissionRequestService(services))
    router.service(SubjectService, createSubjectService(services))
    router.service(ReplicaReaperHandler, createReaperService({ ...services, crypto }))
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
  instructions:
    "Help users understand and manage realms, permissions, approvers, and access request flows. " +
    "Explain access decisions in practical terms. " +
    "Before suggesting permission changes, clarify the subject, permission, and scope when they are missing. " +
    "Do not claim that a permission was granted or denied unless available data confirms it.",
})

await startServer(server)

await startTemporalWorker({
  services,
  activities: {
    ...services.operationService.activities,
    ...createAccessActivities(services),
    ...interactionActivities,
  },
})

logger.info("access replica started")
