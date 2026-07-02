import type { OperationServiceClient } from "@reside/api/common/operation.v1"
import type { EnsureGatewayResult } from "@reside/api/infra/gateway.v1"
import type { AvatarServiceClient as InteractionAvatarServiceClient } from "@reside/api/interaction/avatar.v1"
import type { CommonServices } from "./services"
import type {
  CommandDefinitionParameter,
  CommandDefinition as WorkflowCommandDefinition,
} from "./workflow/command"
import { waitForOperationSuccess, waitForResult } from "@reside/api"
import { CommandParameterType } from "@reside/api/interaction/definition.v1"
import { WellKnownPermissions } from "@reside/registry"
import { getReplicaCallbackEndpoint, getReplicaEndpoint, getReplicaName } from "./kubernetes"
import { logger } from "./logger"

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

export type ReaperHandlerDefinition = {
  resourceReplicaName: string
  title: string
  callbackEndpoint?: string
}

export type DefinedGateway = {
  name: string
  endpoint: string
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

type ReaperDefineResourcesOptions<TApiGroups extends string> = "reaper" extends TApiGroups
  ? {
      /**
       * The optional reaper handlers to register.
       */
      reaperHandlers?: ReaperHandlerDefinition[]
    }
  : {
      reaperHandlers?: never
    }

export type DefineCommonResourcesOptions<TApiGroups extends string = string> = {
  /**
   * The services to use for defining permissions.
   */
  services: Partial<CommonServices<TApiGroups>>
} & AccessDefineResourcesOptions<TApiGroups> &
  InteractionDefineResourcesOptions<TApiGroups> &
  ReaperDefineResourcesOptions<TApiGroups>

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

type EnsureGatewayDefinitionOptions = {
  services: Pick<CommonServices<"infra">, "gatewayService" | "infraOperationService">
} & GatewayDefinition

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

  const ensureAvatarResponse = await runOptionalBootstrapCall(
    {
      action: "ensure interaction avatar",
      target: "interaction.avatarService.ensureAvatar",
      resource: getReplicaName(),
    },
    async () =>
      await avatarService.ensureAvatar({
        replicaTitle: normalizedAvatarTitle,
      }),
  )

  if (!ensureAvatarResponse?.operation) {
    return
  }

  const avatarOperation = ensureAvatarResponse.operation

  await runOptionalBootstrapCall(
    {
      action: "wait for interaction avatar operation",
      target: "interaction.operationService.waitForOperationSuccess",
      resource: String(avatarOperation.id),
    },
    async () =>
      await waitForOperationSuccess(avatarOperation, {
        operationService,
      }),
  )
}

type BootstrapCallContext = {
  action: string
  target: string
  resource?: string
}

async function runRequiredBootstrapCall<T>(
  context: BootstrapCallContext,
  callback: () => Promise<T>,
): Promise<T> {
  try {
    return await callback()
  } catch (error) {
    const wrappedError = createBootstrapCallError(context, error)
    logBootstrapCallError("error", context, wrappedError)
    throw wrappedError
  }
}

async function runOptionalBootstrapCall<T>(
  context: BootstrapCallContext,
  callback: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await callback()
  } catch (error) {
    const wrappedError = createBootstrapCallError(context, error)
    logBootstrapCallError("warn", context, wrappedError)
    return undefined
  }
}

function createBootstrapCallError(context: BootstrapCallContext, error: unknown): Error {
  const resourceSuffix = context.resource ? ` for "${context.resource}"` : ""

  return new Error(
    `Failed to ${context.action}${resourceSuffix} during bootstrap of replica "${getReplicaName()}" using ${context.target}`,
    {
      cause: normalizeError(error),
    },
  )
}

function logBootstrapCallError(
  level: "error" | "warn",
  context: BootstrapCallContext,
  error: Error,
): void {
  logger[level](
    { error },
    'bootstrap call failed replica="%s" action="%s" target="%s" resource="%s"',
    getReplicaName(),
    context.action,
    context.target,
    context.resource ?? "",
  )
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
  avatarTitle,
  commands = [],
  notificationsChannels = [],
  reaperHandlers = [],
}: DefineCommonResourcesOptions<TApiGroups>): Promise<void> {
  const accessServices = services as Partial<CommonServices<"access">>
  const interactionServices = services as Partial<CommonServices<"interaction">>
  const reaperServices = services as Partial<CommonServices<"reaper">>

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
    ...commands.map(command => ({
      permissionName: WellKnownPermissions.TELEGRAM_COMMAND_MANAGE,
      scope: command.name,
    })),
    ...notificationsChannels.map(channel => ({
      permissionName: WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_MANAGE,
      scope: channel.name,
    })),
    ...reaperHandlers.map(handler => ({
      permissionName: WellKnownPermissions.REAPER_HANDLER_REGISTER,
      scope: handler.resourceReplicaName,
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
    "defining common resources: permissions=%d, realms=%d, commands=%d, notificationChannels=%d, reaperHandlers=%d, permissionRequestItems=%d",
    permissions.length,
    realms.length,
    commands.length,
    notificationsChannels.length,
    reaperHandlers.length,
    uniqueRequestItems.length,
  )

  if (uniqueRequestItems.length > 0 && shouldRequestBootstrapPermissions()) {
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

    const { operation } = await runRequiredBootstrapCall(
      {
        action: "request access permissions set",
        target: "access.permissionRequestService.requestPermissions",
        resource: "define-common-resources",
      },
      async () =>
        await accessRequestService.requestPermissions({
          reason: `Для определения ресурсов, необходимых для работы реплики ${getReplicaName()}`,
          permissionSetName: "define-common-resources",
          items: uniqueRequestItems,
        }),
    )

    if (operation) {
      logger.info("waiting for permission request operation to complete")
      await runRequiredBootstrapCall(
        {
          action: "wait for access permission request operation",
          target: "access.operationService.waitForOperationSuccess",
          resource: String(operation.id),
        },
        async () =>
          await waitForOperationSuccess(operation, { operationService: accessOperationService }),
      )
      logger.info("permission request operation completed successfully")
    } else {
      logger.info("permission request returned no operation to wait for")
    }
  } else if (uniqueRequestItems.length > 0) {
    logger.info(
      'skipping access permissions request for statically bootstrapped replica "%s" with %d items',
      process.env.REPLICA_NAME ?? "",
      uniqueRequestItems.length,
    )
  }

  if (permissions.length > 0) {
    const accessDefinitionService = requireService(
      accessServices.accessDefinitionService,
      "accessDefinitionService",
    )

    await runRequiredBootstrapCall(
      {
        action: "define access permissions",
        target: "access.definitionService.putPermissions",
        resource: permissions.map(permission => permission.name).join(","),
      },
      async () => await accessDefinitionService.putPermissions({ permissions }),
    )
    logger.info("defined %d access permissions", permissions.length)
  }

  if (realms.length > 0) {
    const accessDefinitionService = requireService(
      accessServices.accessDefinitionService,
      "accessDefinitionService",
    )

    for (const realm of realms) {
      await runRequiredBootstrapCall(
        {
          action: "define access realm",
          target: "access.definitionService.putRealm",
          resource: realm.name,
        },
        async () =>
          await accessDefinitionService.putRealm({
            ...realm,
            subjectServiceEndpoint:
              realm.subjectServiceEndpoint?.trim() || getReplicaCallbackEndpoint(),
          }),
      )
    }

    logger.info("defined %d access realms", realms.length)
  }

  if (commands.length > 0) {
    const interactionDefinitionService = requireService(
      interactionServices.interactionDefinitionService,
      "interactionDefinitionService",
    )

    await runRequiredBootstrapCall(
      {
        action: "define interaction commands",
        target: "interaction.definitionService.putCommands",
        resource: commands.map(command => command.name).join(","),
      },
      async () =>
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
        }),
    )

    logger.info("defined %d interaction commands", commands.length)
  }

  if (notificationsChannels.length > 0) {
    const interactionDefinitionService = requireService(
      interactionServices.interactionDefinitionService,
      "interactionDefinitionService",
    )

    await runRequiredBootstrapCall(
      {
        action: "define interaction notification channels",
        target: "interaction.definitionService.putChannels",
        resource: notificationsChannels.map(channel => channel.name).join(","),
      },
      async () =>
        await interactionDefinitionService.putChannels({
          channels: notificationsChannels,
        }),
    )

    logger.info("defined %d interaction notification channels", notificationsChannels.length)
  }

  if (reaperHandlers.length > 0) {
    const reaperDefinitionService = requireService(
      reaperServices.reaperDefinitionService,
      "reaperDefinitionService",
    )

    const response = await runOptionalBootstrapCall(
      {
        action: "define reaper handlers",
        target: "reaper.definitionService.putHandlers",
        resource: reaperHandlers.map(handler => handler.resourceReplicaName).join(","),
      },
      async () =>
        await reaperDefinitionService.putHandlers({
          handlers: reaperHandlers.map(handler => ({
            resourceReplicaName: handler.resourceReplicaName,
            title: handler.title,
            callbackEndpoint: handler.callbackEndpoint?.trim() || `${getReplicaEndpoint()}:80`,
          })),
        }),
    )

    if (response !== undefined) {
      logger.info("defined %d reaper handlers", reaperHandlers.length)
    }
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

  return
}

function shouldRequestBootstrapPermissions(): boolean {
  return process.env.REPLICA_NAME !== "access" && process.env.REPLICA_NAME !== "infra"
}

function requireService<TService>(service: TService | undefined, serviceName: string): TService {
  if (service !== undefined) {
    return service
  }

  throw new Error(`Missing required service "${serviceName}" in defineCommonResources`)
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}

export async function defineGateway({
  services,
  name,
  title,
  description,
}: EnsureGatewayDefinitionOptions): Promise<DefinedGateway> {
  const gatewayService = requireService(services.gatewayService, "gatewayService")
  const infraOperationService = requireService(
    services.infraOperationService,
    "infraOperationService",
  )

  const response = await runRequiredBootstrapCall(
    {
      action: "ensure infra gateway",
      target: "infra.gatewayService.ensureGateway",
      resource: name,
    },
    async () =>
      await gatewayService.ensureGateway({
        name,
        title,
        description,
      }),
  )

  if (!response.response || response.response.case === undefined) {
    throw new Error(`Gateway "${name}" ensure response is empty`)
  }

  const gatewayResponse = response.response

  const result = await runRequiredBootstrapCall(
    {
      action: "wait for infra gateway operation",
      target: "infra.operationService.waitForResult",
      resource: name,
    },
    async () =>
      await waitForResult<EnsureGatewayResult>(gatewayResponse, {
        operationService: infraOperationService,
      }),
  )

  const endpoint = result.endpoint.trim()
  if (endpoint.length === 0) {
    throw new Error(`Gateway "${name}" endpoint is missing in operation result`)
  }

  return {
    name,
    endpoint,
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
