import { AuthzServiceDefinition } from "@reside/api/access/authz.v1"
import { DefinitionServiceDefinition as AccessDefinitionServiceDefinition } from "@reside/api/access/definition.v1"
import { PermissionRequestServiceDefinition } from "@reside/api/access/request.v1"
import { OperationServiceDefinition } from "@reside/api/common/operation.v1"
import { ProvisionServiceDefinition } from "@reside/api/database/provision.v1"
import { DefinitionServiceDefinition as InteractionDefinitionServiceDefinition } from "@reside/api/interaction/definition.v1"
import { NotificationServiceDefinition } from "@reside/api/interaction/notification.v1"
import {
  createChannels,
  createClient,
  createPostgresPool,
  createTemporalClient,
} from "@reside/common"
import { engineerReplica } from "@reside/topology"
import { PrismaClient } from "../database"

export async function createServices() {
  const channels = await createChannels(engineerReplica.endpoints)

  const databaseProvisionService = createClient(ProvisionServiceDefinition, channels.database)
  const databaseOperationService = createClient(OperationServiceDefinition, channels.database)

  const accessRequestService = createClient(PermissionRequestServiceDefinition, channels.access)
  const accessOperationService = createClient(OperationServiceDefinition, channels.access)
  const accessDefinitionService = createClient(AccessDefinitionServiceDefinition, channels.access)
  const accessAuthzService = createClient(AuthzServiceDefinition, channels.access)

  const interactionDefinitionService = createClient(
    InteractionDefinitionServiceDefinition,
    channels.interaction,
  )
  const interactionNotificationService = createClient(
    NotificationServiceDefinition,
    channels.interaction,
  )
  const interactionOperationService = createClient(OperationServiceDefinition, channels.interaction)

  const { pool, adapter } = await createPostgresPool({
    provisionService: databaseProvisionService,
    operationService: databaseOperationService,
  })

  const prisma = new PrismaClient({ adapter })

  const temporalClient = await createTemporalClient({
    provisionService: databaseProvisionService,
    operationService: databaseOperationService,
  })

  return {
    pool,
    prisma,
    temporalClient,
    databaseProvisionService,
    databaseOperationService,
    accessRequestService,
    accessOperationService,
    accessDefinitionService,
    accessAuthzService,
    interactionDefinitionService,
    interactionNotificationService,
    interactionOperationService,
  }
}
