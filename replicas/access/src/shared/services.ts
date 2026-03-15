import { status as grpcStatus } from "@grpc/grpc-js"
import { AuthzServiceDefinition } from "@reside/api/access/authz.v1"
import { BindingServiceDefinition } from "@reside/api/access/binding.v1"
import { DefinitionServiceDefinition } from "@reside/api/access/definition.v1"
import { PermissionRequestServiceDefinition } from "@reside/api/access/request.v1"
import { OperationServiceDefinition } from "@reside/api/common/operation.v1"
import { SubjectServiceDefinition } from "@reside/api/common/subject.v1"
import { ProvisionServiceDefinition } from "@reside/api/database/provision.v1"
import {
  createChannels,
  createClient,
  createGenericOperationService,
  createPostgresPool,
  createTemporalClient,
} from "@reside/common"
import { accessReplica } from "@reside/topology"
import { isGrpcServiceError } from "@temporalio/client"
import { PrismaClient } from "../database"

export async function createServices() {
  const channels = await createChannels(accessReplica.endpoints)

  const databaseProvisionService = createClient(ProvisionServiceDefinition, channels.database)
  const databaseOperationService = createClient(OperationServiceDefinition, channels.database)

  const authzService = createClient(AuthzServiceDefinition, channels.self)
  const bindingService = createClient(BindingServiceDefinition, channels.self)
  const definitionService = createClient(DefinitionServiceDefinition, channels.self)
  const permissionRequestService = createClient(PermissionRequestServiceDefinition, channels.self)
  const operationStatusService = createClient(OperationServiceDefinition, channels.self)
  const subjectService = createClient(SubjectServiceDefinition, channels.self)

  const { pool, adapter } = await createPostgresPool({
    provisionService: databaseProvisionService,
    operationService: databaseOperationService,
  })

  const prisma = new PrismaClient({ adapter })
  const temporalClient = await createTemporalClient({
    provisionService: databaseProvisionService,
    operationService: databaseOperationService,
  })

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
        if (isGrpcServiceError(error) && error.code === grpcStatus.NOT_FOUND) {
          return
        }

        throw error
      }
    },
  })

  return {
    pool,
    prisma,
    temporalClient,
    operationService,
    operationStatusService,
    databaseProvisionService,
    databaseOperationService,
    authzService,
    bindingService,
    definitionService,
    permissionRequestService,
    subjectService,
  }
}
