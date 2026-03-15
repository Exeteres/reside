import { startService } from "@reside/api"
import { AuthzServiceDefinition } from "@reside/api/access/authz.v1"
import { BindingServiceDefinition } from "@reside/api/access/binding.v1"
import { DefinitionServiceDefinition } from "@reside/api/access/definition.v1"
import { PermissionRequestServiceDefinition } from "@reside/api/access/request.v1"
import {
  OperationServiceDefinition,
  OperationSubscriptionServiceDefinition,
} from "@reside/api/common/operation.v1"
import { SubjectServiceDefinition } from "@reside/api/common/subject.v1"
import { createOperationSubscriptionService, logger, runTemporalWorker } from "@reside/common"
import { createServer } from "nice-grpc"
import { createServices } from "../shared"
import { createAccessActivities } from "./activities"
import { createAuthzService } from "./services/authz"
import { createBindingService } from "./services/binding"
import { createDefinitionService } from "./services/definition"
import { createPermissionRequestService } from "./services/request"
import { createSubjectService } from "./services/subject"

await startServer()
await startWorker()

async function startServer(): Promise<void> {
  const { prisma, operationService, temporalClient } = await createServices()
  const server = createServer()

  server.add(AuthzServiceDefinition, createAuthzService(prisma))
  server.add(BindingServiceDefinition, createBindingService(prisma))
  server.add(DefinitionServiceDefinition, createDefinitionService(prisma))
  server.add(
    PermissionRequestServiceDefinition,
    createPermissionRequestService(prisma, operationService, temporalClient),
  )
  server.add(SubjectServiceDefinition, createSubjectService(prisma))
  server.add(OperationServiceDefinition, operationService.implementation)
  server.add(
    OperationSubscriptionServiceDefinition,
    createOperationSubscriptionService(temporalClient),
  )

  await startService(server)

  logger.info("access replica server started")
}

async function startWorker(): Promise<void> {
  const { prisma, operationService, databaseOperationService, databaseProvisionService } =
    await createServices()

  await operationService.startOperationWorker({
    provisionService: databaseProvisionService,
    operationService: databaseOperationService,
  })

  await runTemporalWorker({
    provisionService: databaseProvisionService,
    operationService: databaseOperationService,
    activities: createAccessActivities(prisma, operationService),
  })
}
