import { PermissionRequestService } from "@reside/api/access/request.v1"
import { LoadService } from "@reside/api/alpha/load.v1"
import { OperationService } from "@reside/api/common/operation.v1"
import {
  createClient,
  createCommonServices,
  createPostgresPool,
  createStorageBucketService,
  createTemporalClient,
} from "@reside/common"
import { engineerReplica } from "@reside/registry"
import { PrismaClient } from "../database"

export async function createServices() {
  const services = await createCommonServices(engineerReplica.endpoints)

  const { pool, adapter } = await createPostgresPool(services)
  const prisma = new PrismaClient({ adapter })
  const temporalClient = await createTemporalClient(services)
  const storageBucketService = await createStorageBucketService(services)
  const permissionRequestService = createClient(PermissionRequestService, services.channels.access)
  const accessOperationService = createClient(OperationService, services.channels.access)
  const alphaLoadService = createClient(LoadService, services.channels.alpha)
  const alphaOperationService = createClient(OperationService, services.channels.alpha)

  return {
    ...services,
    pool,
    prisma,
    temporalClient,
    storageBucketService,
    permissionRequestService,
    accessOperationService,
    alphaLoadService,
    alphaOperationService,
  }
}
