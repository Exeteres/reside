import { CustomObjectsApi } from "@kubernetes/client-node"
import { kubeConfig, logger } from "@reside/common"
import { createServices } from "../shared"
import { assertLoadApi } from "./load"
import { assertRegistrationApi } from "./registration"
import { cleanupAlphaE2EData, createAlphaE2EScope } from "./scope"
import { assertSubjectApi } from "./subject"

const services = await createServices()
const scope = createAlphaE2EScope()

const customObjectsApi = kubeConfig.makeApiClient(CustomObjectsApi)

try {
  await cleanupAlphaE2EData(services.prisma, scope)

  logger.info("starting alpha api e2e")

  await assertLoadApi(
    services.loadService,
    services.permissionRequestService,
    services.accessOperationService,
    services.alphaOperationService,
    services.prisma,
    customObjectsApi,
    scope,
  )
  await assertRegistrationApi(services.registrationService, services.prisma, scope)
  await assertSubjectApi(services.subjectService, services.prisma, scope)

  logger.info("alpha api e2e completed")
} finally {
  await cleanupAlphaE2EData(services.prisma, scope)
  await services.prisma.$disconnect()
}
