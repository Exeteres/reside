import { AuthzServiceDefinition } from "@reside/api/access/authz.v1"
import { DefinitionServiceDefinition as AccessDefinitionServiceDefinition } from "@reside/api/access/definition.v1"
import { PermissionRequestServiceDefinition } from "@reside/api/access/request.v1"
import { LoadServiceDefinition } from "@reside/api/alpha/load.v1"
import { RegistrationServiceDefinition } from "@reside/api/alpha/registration.v1"
import { OperationServiceDefinition } from "@reside/api/common/operation.v1"
import { SubjectServiceDefinition } from "@reside/api/common/subject.v1"
import { ProvisionServiceDefinition } from "@reside/api/database/provision.v1"
import { DefinitionServiceDefinition as InteractionDefinitionService } from "@reside/api/interaction/definition.v1"
import { NotificationServiceDefinition } from "@reside/api/interaction/notification.v1"
import {
  createChannels,
  createClient,
  createGenericOperationService,
  createPostgresPool,
  createTemporalClient,
} from "@reside/common"
import { alphaReplica } from "@reside/topology"
import { PrismaClient } from "../database"

export async function createServices() {
  const channels = await createChannels(alphaReplica.endpoints)

  const databaseProvisionService = createClient(ProvisionServiceDefinition, channels.database)
  const databaseOperationService = createClient(OperationServiceDefinition, channels.database)

  const accessRequestService = createClient(PermissionRequestServiceDefinition, channels.access)
  const accessAuthzService = createClient(AuthzServiceDefinition, channels.access)
  const accessOperationService = createClient(OperationServiceDefinition, channels.access)
  const accessDefinitionService = createClient(AccessDefinitionServiceDefinition, channels.access)

  const notificationService = createClient(NotificationServiceDefinition, channels.interaction)
  const interactionOperationService = createClient(OperationServiceDefinition, channels.interaction)
  const interactionDefinitionService = createClient(
    InteractionDefinitionService,
    channels.interaction,
  )

  const { pool, adapter } = await createPostgresPool({
    provisionService: databaseProvisionService,
    operationService: databaseOperationService,
  })

  const prisma = new PrismaClient({ adapter })

  const temporalClient = await createTemporalClient({
    provisionService: databaseProvisionService,
    operationService: databaseOperationService,
  })

  const alphaOperationService = createGenericOperationService({
    prisma,
    temporalClient,
    async getResult() {
      return undefined
    },
  })

  const loadService = createClient(LoadServiceDefinition, channels.self)
  const registrationService = createClient(RegistrationServiceDefinition, channels.self)
  const subjectService = createClient(SubjectServiceDefinition, channels.self)

  return {
    pool,
    prisma,
    alphaOperationService,
    temporalClient,
    databaseProvisionService,
    databaseOperationService,
    accessRequestService,
    accessAuthzService,
    accessOperationService,
    accessDefinitionService,
    notificationService,
    interactionOperationService,
    interactionDefinitionService,
    loadService,
    registrationService,
    subjectService,
  }
}
