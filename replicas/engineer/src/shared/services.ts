import { PermissionRequestService } from "@reside/api/access/request.v1"
import { LoadService } from "@reside/api/alpha/load.v1"
import { OperationService } from "@reside/api/common/operation.v1"
import { TopicService } from "@reside/api/interaction/topic.v1"
import {
  createClient,
  createCommonServices,
  createPostgresPool,
  createTemporalClient,
} from "@reside/common"
import { engineerReplica } from "@reside/registry"
import { PrismaClient } from "../database"

export async function createServices() {
  const services = await createCommonServices(engineerReplica.endpoints)

  const { pool, adapter } = await createPostgresPool(services)
  const prisma = new PrismaClient({ adapter })
  const temporalClient = await createTemporalClient(services)
  const permissionRequestService = createClient(PermissionRequestService, services.channels.access)
  const accessOperationService = createClient(OperationService, services.channels.access)
  const alphaLoadService = createClient(LoadService, services.channels.alpha)
  const alphaOperationService = createClient(OperationService, services.channels.alpha)
  const topicService = createClient(TopicService, services.channels.interaction)

  return {
    ...services,
    pool,
    prisma,
    temporalClient,
    permissionRequestService,
    accessOperationService,
    alphaLoadService,
    alphaOperationService,
    topicService,
  }
}
