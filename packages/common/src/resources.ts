import { waitForOperationSuccess } from "@reside/api"
import type { DefinitionServiceClient as AccessDefinitionServiceClient } from "@reside/api/access/definition.v1"
import type { PermissionRequestServiceClient } from "@reside/api/access/request.v1"
import type { OperationServiceClient } from "@reside/api/common/operation.v1"
import {
  CommandParameterType,
  type DefinitionServiceClient as InteractionDefinitionServiceClient,
} from "@reside/api/interaction/definition.v1"
import { getReplicaEndpoint, getReplicaName } from "./kubernetes"
import { logger } from "./logger"
import { WellKnownPermissions } from "./permissions"
import type {
  CommandDefinition as WorkflowCommandDefinition,
  CommandDefinitionParameter,
} from "./workflow/command"

export type PermissionDefinition = {
  name: string
  title: string
  description: string
  scoped?: boolean
}

export type RealmDefinition = {
  name: string
  title: string
  description?: string
  subjectServiceEndpoint?: string
}

export type NotificationChannelDefinition = {
  name: string
  title: string
  description?: string
}

export type DefineCommonResourcesOptions = {
  /**
   * The service client to request permissions for managing resources.
   */
  accessRequestService: PermissionRequestServiceClient

  /**
   * The operation service client to wait for permission request operations.
   */
  accessOperationService: OperationServiceClient

  /**
   * The optional access resource definitions.
   */
  access?: {
    /**
     * The Access definition service client.
     */
    definitionService: AccessDefinitionServiceClient

    /**
     * The optional permissions to define.
     */
    permissions?: PermissionDefinition[]

    /**
     * The optional realms to define.
     */
    realms?: RealmDefinition[]
  }

  /**
   * The optional interaction resource definitions.
   */
  interaction?: {
    /**
     * The Interaction definition service client.
     */
    definitionService: InteractionDefinitionServiceClient

    /**
     * The optional commands to define.
     */
    commands?: WorkflowCommandDefinition[]

    /**
     * The optional notification channels to define.
     */
    notificationsChannels?: NotificationChannelDefinition[]
  }
}

/**
 * Defines access and interaction resources with shared permission request clients.
 *
 * @param options The options containing the shared clients and optional resource sections to define.
 */
export async function defineCommonResources({
  accessRequestService,
  accessOperationService,
  access,
  interaction,
}: DefineCommonResourcesOptions): Promise<void> {
  const permissions = access?.permissions ?? []
  const realms = access?.realms ?? []
  const commands = interaction?.commands ?? []
  const notificationChannels = interaction?.notificationsChannels ?? []

  const requestItems = [
    ...permissions.map(permission => ({
      permissionName: WellKnownPermissions.ACCESS_PERMISSION_MANAGE,
      scope: permission.name,
    })),
    ...realms.map(realm => ({
      permissionName: WellKnownPermissions.ACCESS_REALM_MANAGE,
      scope: realm.name,
    })),
    ...commands.map(command => ({
      permissionName: WellKnownPermissions.TELEGRAM_COMMAND_MANAGE,
      scope: command.name,
    })),
    ...notificationChannels.map(channel => ({
      permissionName: WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_MANAGE,
      scope: channel.name,
    })),
  ]

  const uniqueRequestItems = Array.from(
    new Map(requestItems.map(item => [`${item.permissionName}:${item.scope}`, item])).values(),
  )

  logger.info(
    "defining common resources: permissions=%d, realms=%d, commands=%d, notificationChannels=%d, permissionRequestItems=%d",
    permissions.length,
    realms.length,
    commands.length,
    notificationChannels.length,
    uniqueRequestItems.length,
  )

  if (uniqueRequestItems.length > 0) {
    logger.info(
      'requesting access permissions set "%s" for replica "%s" with %d items',
      "define-common-resources",
      getReplicaName(),
      uniqueRequestItems.length,
    )

    const { operation } = await accessRequestService.requestPermissions({
      reason: `Для определения ресурсов, необходимых для работы реплики ${getReplicaName()}`,
      permissionSetName: "define-common-resources",
      items: uniqueRequestItems,
    })

    if (operation) {
      logger.info("waiting for permission request operation to complete")
      await waitForOperationSuccess(operation, { operationService: accessOperationService })
      logger.info("permission request operation completed successfully")
    } else {
      logger.info("permission request returned no operation to wait for")
    }
  }

  if (permissions.length > 0 && access) {
    await access.definitionService.putPermissions({ permissions })
    logger.info("defined %d access permissions", permissions.length)
  }

  if (realms.length > 0 && access) {
    for (const realm of realms) {
      await access.definitionService.putRealm(realm)
    }

    logger.info("defined %d access realms", realms.length)
  }

  if (commands.length > 0 && interaction) {
    await interaction.definitionService.putCommands({
      commands: commands.map(command => ({
        name: command.name,
        title: command.title,
        description: command.description,
        protected: command.protected,
        callbackEndpoint: `${getReplicaEndpoint()}:80`,
        parameters: Object.entries(command.params ?? {}).map(([name, parameter]) => ({
          name,
          title: parameter.title,
          description: parameter.description,
          type: mapCommandParameterType(parameter),
          required: parameter.required === true,
          rest: parameter.rest === true,
        })),
      })),
    })

    logger.info("defined %d interaction commands", commands.length)
  }

  if (notificationChannels.length > 0 && interaction) {
    await interaction.definitionService.putChannels({
      channels: notificationChannels,
    })

    logger.info("defined %d interaction notification channels", notificationChannels.length)
  }
}

function mapCommandParameterType(parameter: CommandDefinitionParameter): CommandParameterType {
  switch (parameter.type) {
    case "string":
      return CommandParameterType.STRING
    case "integer":
      return CommandParameterType.INTEGER
    case "boolean":
      return CommandParameterType.BOOLEAN
  }
}
