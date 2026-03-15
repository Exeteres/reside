import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type {
  Command,
  DefinitionServiceImplementation,
  NotificationChannel,
  PutChannelsRequest,
  PutChannelsResponse,
  PutCommandsRequest,
  PutCommandsResponse,
} from "@reside/api/interaction/definition.v1"
import type { PrismaClient } from "../../database"
import { status } from "@grpc/grpc-js"
import { authenticateReplica, logger, WellKnownPermissions } from "@reside/common"
import { type CallContext, ServerError } from "nice-grpc"

export function createDefinitionService(
  prisma: PrismaClient,
  authzService: AuthzServiceClient,
): DefinitionServiceImplementation {
  return {
    async putChannels(
      request: PutChannelsRequest,
      context: CallContext,
    ): Promise<PutChannelsResponse> {
      const { name: replicaName } = await authenticateReplica(context)
      logger.info(
        "putChannels requested by replica %s for %d channels",
        replicaName,
        request.channels.length,
      )
      assertUniqueNames(
        request.channels.map(channel => channel.name),
        "channels",
      )

      const subjectId = `replica:${replicaName}`

      await Promise.all(
        request.channels.map(async channel => {
          await assertAllowedToManage(
            authzService,
            subjectId,
            WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_MANAGE,
            channel.name,
          )
        }),
      )

      const channels = await Promise.all(
        request.channels.map(async channel => {
          return await prisma.notificationChannel.upsert({
            where: {
              name: channel.name,
            },
            create: {
              name: channel.name,
              title: channel.title,
              description: channel.description ?? null,
            },
            update: {
              title: channel.title,
              description: channel.description ?? null,
            },
          })
        }),
      )

      logger.info("notification channels upserted by replica %s: %d", replicaName, channels.length)

      return {
        channels: channels.map(toNotificationChannel),
      }
    },

    async putCommands(
      request: PutCommandsRequest,
      context: CallContext,
    ): Promise<PutCommandsResponse> {
      const { name: replicaName } = await authenticateReplica(context)
      logger.info(
        "putCommands requested by replica %s for %d commands",
        replicaName,
        request.commands.length,
      )

      assertUniqueNames(
        request.commands.map(command => command.name),
        "commands",
      )

      for (const command of request.commands) {
        assertUniqueNames(
          command.parameters.map(parameter => parameter.name),
          `parameters of command "${command.name}"`,
        )

        assertCommandRestParameterShape(command.name, command.parameters)
      }

      const subjectId = `replica:${replicaName}`

      await Promise.all(
        request.commands.map(async command => {
          await assertAllowedToManage(
            authzService,
            subjectId,
            WellKnownPermissions.TELEGRAM_COMMAND_MANAGE,
            command.name,
          )
        }),
      )

      const commands = await Promise.all(
        request.commands.map(async command => {
          const callbackEndpoint = command.callbackEndpoint.trim()
          if (callbackEndpoint.length === 0) {
            throw new ServerError(
              status.INVALID_ARGUMENT,
              `Command "${command.name}" must provide non-empty callback_endpoint`,
            )
          }

          return await prisma.command.upsert({
            where: {
              name: command.name,
            },
            create: {
              name: command.name,
              title: command.title,
              description: command.description ?? null,
              parameters: command.parameters as unknown as PrismaJson.CommandParameters,
              isProtected: command.protected === true,
              callbackEndpoint,
            },
            update: {
              title: command.title,
              description: command.description ?? null,
              parameters: command.parameters as unknown as PrismaJson.CommandParameters,
              isProtected: command.protected === true,
              callbackEndpoint,
            },
          })
        }),
      )

      logger.info("commands upserted by replica %s: %d", replicaName, commands.length)

      return {
        commands: commands.map(toCommand),
      }
    },
  }
}

async function assertAllowedToManage(
  authzService: AuthzServiceClient,
  subjectId: string,
  permissionName: WellKnownPermissions,
  scope: string,
): Promise<void> {
  logger.debug(
    "checking manage permission %s for subject %s and scope %s",
    permissionName,
    subjectId,
    scope,
  )

  const check = await authzService.checkPermission({
    permissionName,
    subjectId,
    scope,
  })

  if (check.authorized) {
    return
  }

  throw new ServerError(
    status.PERMISSION_DENIED,
    `Subject "${subjectId}" is not allowed to manage resource with permission "${permissionName}" and scope "${scope}"`,
  )
}

function toCommand(input: {
  id: number
  name: string
  title: string
  description: string | null
  parameters: unknown
  isProtected: boolean
  callbackEndpoint: string
}): Command {
  const parameters = Array.isArray(input.parameters)
    ? (input.parameters as Command["parameters"])
    : ([] as Command["parameters"])

  return {
    id: input.id,
    name: input.name,
    title: input.title,
    description: input.description ?? undefined,
    parameters: parameters.map(parameter => ({
      name: parameter.name,
      title: parameter.title,
      description: parameter.description,
      type: parameter.type,
      required: parameter.required === true,
      rest: parameter.rest === true,
    })),
    protected: input.isProtected,
    callbackEndpoint: input.callbackEndpoint,
  }
}

function assertUniqueNames(names: string[], fieldName: string): void {
  const knownNames = new Set<string>()

  for (const rawName of names) {
    const name = rawName.trim()
    if (name.length === 0) {
      throw new ServerError(status.INVALID_ARGUMENT, `Field "${fieldName}" contains empty name`)
    }

    if (knownNames.has(name)) {
      throw new ServerError(
        status.INVALID_ARGUMENT,
        `Field "${fieldName}" contains duplicate name "${name}"`,
      )
    }

    knownNames.add(name)
  }
}

function assertCommandRestParameterShape(
  commandName: string,
  parameters: Command["parameters"],
): void {
  const restIndexes: number[] = []

  for (let index = 0; index < parameters.length; index++) {
    if (parameters[index]?.rest === true) {
      restIndexes.push(index)
    }
  }

  if (restIndexes.length === 0) {
    return
  }

  if (restIndexes.length > 1) {
    throw new ServerError(
      status.INVALID_ARGUMENT,
      `Command "${commandName}" must have at most one rest parameter`,
    )
  }

  const restIndex = restIndexes[0]!
  if (restIndex !== parameters.length - 1) {
    throw new ServerError(
      status.INVALID_ARGUMENT,
      `Command "${commandName}" must declare rest parameter as the last parameter`,
    )
  }
}

function toNotificationChannel(channel: {
  id: number
  name: string
  title: string
  description: string | null
}): NotificationChannel {
  return {
    id: channel.id,
    name: channel.name,
    title: channel.title,
    description: channel.description ?? undefined,
  }
}
