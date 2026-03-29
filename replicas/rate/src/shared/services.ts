import { PermissionRequestServiceDefinition } from "@reside/api/access/request.v1"
import { OperationServiceDefinition } from "@reside/api/common/operation.v1"
import { ProvisionServiceDefinition } from "@reside/api/database/provision.v1"
import { DefinitionServiceDefinition as InteractionDefinitionServiceDefinition } from "@reside/api/interaction/definition.v1"
import { NotificationServiceDefinition } from "@reside/api/interaction/notification.v1"
import { createChannels, createClient, createTemporalClient } from "@reside/common"
import { rateReplica } from "@reside/topology"

export async function createServices() {
  const channels = await createChannels(rateReplica.endpoints)

  const databaseProvisionService = createClient(ProvisionServiceDefinition, channels.database)
  const databaseOperationService = createClient(OperationServiceDefinition, channels.database)

  const accessRequestService = createClient(PermissionRequestServiceDefinition, channels.access)
  const accessOperationService = createClient(OperationServiceDefinition, channels.access)

  const interactionDefinitionService = createClient(
    InteractionDefinitionServiceDefinition,
    channels.interaction,
  )
  const interactionNotificationService = createClient(
    NotificationServiceDefinition,
    channels.interaction,
  )
  const interactionOperationService = createClient(OperationServiceDefinition, channels.interaction)

  const temporalClient = await createTemporalClient({
    provisionService: databaseProvisionService,
    operationService: databaseOperationService,
  })

  return {
    temporalClient,
    databaseProvisionService,
    databaseOperationService,
    accessRequestService,
    accessOperationService,
    interactionDefinitionService,
    interactionNotificationService,
    interactionOperationService,
  }
}
