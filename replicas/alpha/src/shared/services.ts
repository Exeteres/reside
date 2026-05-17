import { LoadService } from "@reside/api/alpha/load.v1"
import { RegistrationService } from "@reside/api/alpha/registration.v1"
import { SubjectService } from "@reside/api/common/subject.v1"
import {
  createClient,
  createCommonServices,
  createGenericOperationService,
  createPostgresPool,
  createTemporalClient,
} from "@reside/common"
import { alphaReplica } from "@reside/registry"
import { PrismaClient } from "../database"

export async function createServices() {
  const services = await createCommonServices(alphaReplica.endpoints)

  const { pool, adapter } = await createPostgresPool(services)

  const prisma = new PrismaClient({ adapter })

  const temporalClient = await createTemporalClient(services)

  const operationService = createGenericOperationService({
    prisma,
    temporalClient,
  })

  const loadService = createClient(LoadService, services.channels.self)
  const registrationService = createClient(RegistrationService, services.channels.self)
  const subjectService = createClient(SubjectService, services.channels.self)

  return {
    ...services,
    pool,
    prisma,
    operationService,
    temporalClient,
    loadService,
    registrationService,
    subjectService,
  }
}
