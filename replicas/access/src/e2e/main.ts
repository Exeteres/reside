import { logger } from "@reside/common"
import { createServices } from "../shared"
import { startE2EApprovalServer } from "./approval"
import { assertAuthzApi } from "./authz"
import { assertBindingApi } from "./binding"
import { assertDefinitionApi } from "./definition"
import { assertRequestApi } from "./request"
import { cleanupAccessE2EData, createAccessE2EScope } from "./scope"
import { ensureE2EManageBindings } from "./setup"
import { assertSubjectApi } from "./subject"

const services = await createServices()
const scope = createAccessE2EScope()
const e2eApprovalServer = await startE2EApprovalServer()
const e2eApprovalEndpoint = e2eApprovalServer.endpoint

try {
  await cleanupAccessE2EData(services.prisma, scope)
  await ensureE2EManageBindings(services.prisma, scope)

  logger.info("starting access api e2e")

  await assertDefinitionApi(services.definitionService, services.prisma, scope)
  await assertRequestApi(
    services.permissionRequestService,
    services.accessOperationStatusService,
    services.definitionService,
    services.prisma,
    e2eApprovalEndpoint,
    scope,
  )
  await assertAuthzApi(services.authzService, services.definitionService, services.prisma, scope)
  await assertBindingApi(
    services.bindingService,
    services.definitionService,
    services.prisma,
    scope,
  )
  await assertSubjectApi(
    services.subjectService,
    services.definitionService,
    services.prisma,
    e2eApprovalEndpoint,
    scope,
  )

  logger.info("access api e2e completed")
} finally {
  await cleanupAccessE2EData(services.prisma, scope)
  await e2eApprovalServer.shutdown()
  await services.prisma.$disconnect()
}
