import { status as GrpcStatus } from "@grpc/grpc-js"
import { AuthzService } from "@reside/api/access/authz.v1"
import { BindingService } from "@reside/api/access/binding.v1"
import { DefinitionService } from "@reside/api/access/definition.v1"
import { PermissionRequestService } from "@reside/api/access/request.v1"
import { OperationService } from "@reside/api/common/operation.v1"
import { SubjectService } from "@reside/api/common/subject.v1"
import {
  createClient,
  createCommonServices,
  createGenericOperationService,
  createPostgresPool,
  createTemporalClient,
} from "@reside/common"
import { accessReplica } from "@reside/registry"
import { isGrpcServiceError } from "@temporalio/client"
import { PrismaClient } from "../database"

export async function createServices() {
  const services = await createCommonServices(accessReplica.endpoints)

  const authzService = createClient(AuthzService, services.channels.self)
  const bindingService = createClient(BindingService, services.channels.self)
  const definitionService = createClient(DefinitionService, services.channels.self)
  const permissionRequestService = createClient(PermissionRequestService, services.channels.self)
  const accessOperationStatusService = createClient(OperationService, services.channels.self)
  const subjectService = createClient(SubjectService, services.channels.self)

  const postgres = await createPostgresPool(services)
  const prisma = new PrismaClient({ adapter: postgres.adapter })
  const temporalClient = await createTemporalClient(services)

  const operationService = createGenericOperationService({
    prisma,
    temporalClient,

    getResult: async operationId => {
      const operation = await prisma.operation.findUnique({
        where: {
          id: operationId,
        },
        include: {
          permissionRequestSet: true,
        },
      })

      if (operation === null || operation.permissionRequestSet === null) {
        throw new Error(`Operation "${operationId}" has no permission request set result`)
      }

      return operation.permissionRequestSet
    },

    cancelOperation: async operationId => {
      try {
        await temporalClient.workflow
          .getHandle(`approve-permission-request-set-${operationId}`)
          .cancel()
      } catch (error) {
        if (isGrpcServiceError(error) && error.code === GrpcStatus.NOT_FOUND) {
          return
        }

        throw error
      }
    },
  })

  return {
    ...services,
    pool: postgres.pool,
    prisma,
    temporalClient,
    operationService,
    accessOperationStatusService,
    authzService,
    bindingService,
    definitionService,
    permissionRequestService,
    subjectService,
  }
}
