import { waitForOperationSuccess } from "@reside/api"
import type { OperationServiceClient } from "@reside/api/common/operation.v1"
import type { AvatarServiceClient as InteractionAvatarServiceClient } from "@reside/api/interaction/avatar.v1"
import { CommandParameterType } from "@reside/api/interaction/definition.v1"
import { WellKnownPermissions } from "@reside/registry"
import { getReplicaCallbackEndpoint, getReplicaEndpoint, getReplicaName } from "./kubernetes"
import { logger } from "./logger"
import type {
  CommandDefinition as WorkflowCommandDefinition,
  CommandDefinitionParameter,
} from "./workflow/command"
import type { CommonServices } from "./services"

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

export type GatewayDefinition = {
  name: string
  title: string
  description?: string
}

type AccessDefineResourcesOptions<TApiGroups extends string> = "access" extends TApiGroups
  ? {
      /**
       * The permissions to define.
       */
      permissions?: PermissionDefinition[]

      /**
       * The realms to define.
       */
      realms?: RealmDefinition[]
    }
  : {
      permissions?: never
      realms?: never
    }

type InfraDefineResourcesOptions<TApiGroups extends string> = "infra" extends TApiGroups
  ? {
      /**
       * The gateways to define.
       */
      gateways?: GatewayDefinition[]
    }
  : {
      gateways?: never
    }

type InteractionDefineResourcesOptions<TApiGroups extends string> = "interaction" extends TApiGroups
  ? {
      /**
       * The localized replica title used for avatar provisioning.
       */
      avatarTitle?: string

      /**
       * The optional commands to define.
       */
      commands?: WorkflowCommandDefinition[]

      /**
       * The optional notification channels to define.
       */
      notificationsChannels?: NotificationChannelDefinition[]
    }
  : {
      avatarTitle?: never
      commands?: never
      notificationsChannels?: never
    }

export type DefineCommonResourcesOptions<TApiGroups extends string = string> = {
  /**
   * The services to use for defining permissions.
   */
  services: Partial<CommonServices<TApiGroups>>
} & AccessDefineResourcesOptions<TApiGroups> &
  InfraDefineResourcesOptions<TApiGroups> &
  InteractionDefineResourcesOptions<TApiGroups>

export type EnsureReplicaAvatarOptions = {
  /**
   * The Interaction avatar service client.
   */
  avatarService: InteractionAvatarServiceClient

  /**
   * The operation service used to track interaction operations.
   */
  operationService: OperationServiceClient

  /**
   * The localized replica title used for avatar provisioning.
   */
  avatarTitle?: string
}

/**
 * Ensures that an avatar exists for the current replica.
 *
 * @param options The options containing avatar service dependencies and replica title.
 */
export async function ensureReplicaAvatar({
  avatarService,
  operationService,
  avatarTitle,
}: EnsureReplicaAvatarOptions): Promise<void> {
  if (typeof avatarTitle !== "string") {
    return
  }

  const normalizedAvatarTitle = avatarTitle.trim()
  if (normalizedAvatarTitle.length === 0) {
    return
  }

  try {
    const ensureAvatarResponse = await avatarService.ensureAvatar({
      replicaTitle: normalizedAvatarTitle,
    })

    if (ensureAvatarResponse.operation) {
      await waitForOperationSuccess(ensureAvatarResponse.operation, {
        operationService,
      })
    }
  } catch (error) {
    logger.error({ error }, "failed to ensure avatar for replica %s", getReplicaName())
  }
}

/**
 * Defines access and interaction resources with shared permission request clients.
 *
 * @param options The options containing the shared clients and optional resource sections to define.
 */
export async function defineCommonResources<TApiGroups extends string = string>({
  services,
  permissions = [],
  realms = [],
  gateways = [],
  avatarTitle,
  commands = [],
  notificationsChannels = [],
}: DefineCommonResourcesOptions<TApiGroups>): Promise<void> {
  const accessServices = services as Partial<CommonServices<"access">>
  const infraServices = services as Partial<CommonServices<"infra">>
  const interactionServices = services as Partial<CommonServices<"interaction">>

  const shouldCreateAvatar = typeof avatarTitle === "string" && avatarTitle.trim().length > 0

  const requestItems = [
    ...permissions.map(permission => ({
      permissionName: WellKnownPermissions.ACCESS_PERMISSION_MANAGE,
      scope: permission.name,
    })),
    ...realms.map(realm => ({
      permissionName: WellKnownPermissions.ACCESS_REALM_MANAGE,
      scope: realm.name,
    })),
    ...gateways.map(gateway => ({
      permissionName: WellKnownPermissions.INFRA_GATEWAY_MANAGE,
      scope: gateway.name,
    })),
    ...commands.map(command => ({
      permissionName: WellKnownPermissions.TELEGRAM_COMMAND_MANAGE,
      scope: command.name,
    })),
    ...notificationsChannels.map(channel => ({
      permissionName: WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_MANAGE,
      scope: channel.name,
    })),
    ...(shouldCreateAvatar
      ? [
          {
            permissionName: WellKnownPermissions.TELEGRAM_AVATAR_OWN,
            scope: getReplicaName(),
          },
        ]
      : []),
  ]

  const uniqueRequestItems = Array.from(
    new Map(requestItems.map(item => [`${item.permissionName}:${item.scope}`, item])).values(),
  )

  logger.info(
    "defining common resources: permissions=%d, realms=%d, gateways=%d, commands=%d, notificationChannels=%d, permissionRequestItems=%d",
    permissions.length,
    realms.length,
    gateways.length,
    commands.length,
    notificationsChannels.length,
    uniqueRequestItems.length,
  )

  if (uniqueRequestItems.length > 0) {
    const accessRequestService = requireService(
      accessServices.permissionRequestService,
      "permissionRequestService",
    )
    const accessOperationService = requireService(
      accessServices.accessOperationService,
      "accessOperationService",
    )

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

  if (permissions.length > 0) {
    const accessDefinitionService = requireService(
      accessServices.accessDefinitionService,
      "accessDefinitionService",
    )

    await accessDefinitionService.putPermissions({ permissions })
    logger.info("defined %d access permissions", permissions.length)
  }

  if (realms.length > 0) {
    const accessDefinitionService = requireService(
      accessServices.accessDefinitionService,
      "accessDefinitionService",
    )

    for (const realm of realms) {
      await accessDefinitionService.putRealm({
        ...realm,
        subjectServiceEndpoint:
          realm.subjectServiceEndpoint?.trim() || getReplicaCallbackEndpoint(),
      })
    }

    logger.info("defined %d access realms", realms.length)
  }

  if (gateways.length > 0) {
    const gatewayService = requireService(infraServices.gatewayService, "gatewayService")
    const infraOperationService = requireService(
      infraServices.infraOperationService,
      "infraOperationService",
    )

    for (const gateway of gateways) {
      const { operation } = await gatewayService.ensureGateway({
        name: gateway.name,
        title: gateway.title,
        description: gateway.description,
      })

      if (operation) {
        await waitForOperationSuccess(operation, {
          operationService: infraOperationService,
        })
      }
    }

    logger.info("defined %d infra gateways", gateways.length)
  }

  if (commands.length > 0) {
    const interactionDefinitionService = requireService(
      interactionServices.interactionDefinitionService,
      "interactionDefinitionService",
    )

    await interactionDefinitionService.putCommands({
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

  if (notificationsChannels.length > 0) {
    const interactionDefinitionService = requireService(
      interactionServices.interactionDefinitionService,
      "interactionDefinitionService",
    )

    await interactionDefinitionService.putChannels({
      channels: notificationsChannels,
    })

    logger.info("defined %d interaction notification channels", notificationsChannels.length)
  }

  if (shouldCreateAvatar) {
    const avatarService = requireService(interactionServices.avatarService, "avatarService")
    const interactionOperationService = requireService(
      interactionServices.interactionOperationService,
      "interactionOperationService",
    )

    await ensureReplicaAvatar({
      avatarService,
      operationService: interactionOperationService,
      avatarTitle,
    })
  }
}

function requireService<TService>(service: TService | undefined, serviceName: string): TService {
  if (service !== undefined) {
    return service
  }

  throw new Error(`Missing required service "${serviceName}" in defineCommonResources`)
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
