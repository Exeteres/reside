import type {
  Command,
  DefinitionServiceImplementation,
} from "@reside/api/interaction/definition.v1"
import type { CommonServices } from "@reside/common"
import type { PrismaClient } from "../../database"
import { create } from "@bufbuild/protobuf"
import { Code, ConnectError } from "@connectrpc/connect"
import {
  CommandParameterSchema,
  CommandSchema,
  NotificationChannelSchema,
} from "@reside/api/interaction/definition.v1"
import { authenticateReplica, logger } from "@reside/common"
import { WellKnownPermissions } from "@reside/registry"
import { validateChannelDefinitions, validateCommandDefinitions } from "../business/definition"

export function createDefinitionService(
  services: CommonServices<"access"> & {
    prisma: PrismaClient
  },
): DefinitionServiceImplementation {
  return {
    async putChannels(request, context) {
      const { name: replicaName } = await authenticateReplica(context)
      logger.info(
        "putChannels requested by replica %s for %d channels",
        replicaName,
        request.channels.length,
      )

      validateChannelDefinitions(
        request.channels.map(channel => ({
          name: channel.name,
          title: channel.title,
          description: channel.description,
        })),
      )

      const subjectId = `replica:${replicaName}`

      await Promise.all(
        request.channels.map(async channel => {
          const check = await services.authzService.checkPermission({
            permissionName: WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_MANAGE,
            subjectId,
            scope: channel.name,
          })

          if (!check.authorized) {
            throw new ConnectError(
              `Subject "${subjectId}" is not allowed to manage channel "${channel.name}"`,
              Code.PermissionDenied,
            )
          }
        }),
      )

      const channels = await Promise.all(
        request.channels.map(async channel => {
          return await services.prisma.notificationChannel.upsert({
            where: {
              name: channel.name,
            },
            create: {
              name: channel.name,
              title: channel.title,
              description: channel.description ?? null,
              ownerReplicaName: replicaName,
            },
            update: {
              title: channel.title,
              description: channel.description ?? null,
              ownerReplicaName: replicaName,
            },
          })
        }),
      )

      return {
        channels: channels.map(channel =>
          create(NotificationChannelSchema, {
            id: channel.id,
            name: channel.name,
            title: channel.title,
            description: channel.description ?? undefined,
          }),
        ),
      }
    },

    async putCommands(request, context) {
      const { name: replicaName } = await authenticateReplica(context)
      logger.info(
        "putCommands requested by replica %s for %d commands",
        replicaName,
        request.commands.length,
      )

      validateCommandDefinitions(
        request.commands.map(command => ({
          name: command.name,
          title: command.title,
          description: command.description,
          callbackEndpoint: command.callbackEndpoint,
          protected: command.protected,
          parameters: command.parameters.map(parameter => ({
            name: parameter.name,
            title: parameter.title,
            description: parameter.description,
            type: String(parameter.type),
            required: parameter.required,
            rest: parameter.rest,
          })),
        })),
      )

      const subjectId = `replica:${replicaName}`

      await Promise.all(
        request.commands.map(async command => {
          const check = await services.authzService.checkPermission({
            permissionName: WellKnownPermissions.TELEGRAM_COMMAND_MANAGE,
            subjectId,
            scope: command.name,
          })

          if (!check.authorized) {
            throw new ConnectError(
              `Subject "${subjectId}" is not allowed to manage command "${command.name}"`,
              Code.PermissionDenied,
            )
          }
        }),
      )

      const commands = await Promise.all(
        request.commands.map(async command => {
          return await services.prisma.command.upsert({
            where: {
              name: command.name,
            },
            create: {
              name: command.name,
              title: command.title,
              description: command.description ?? null,
              parameters: command.parameters as unknown as PrismaJson.CommandParameters,
              isProtected: command.protected === true,
              ownerReplicaName: replicaName,
              callbackEndpoint: command.callbackEndpoint.trim(),
            },
            update: {
              title: command.title,
              description: command.description ?? null,
              parameters: command.parameters as unknown as PrismaJson.CommandParameters,
              isProtected: command.protected === true,
              ownerReplicaName: replicaName,
              callbackEndpoint: command.callbackEndpoint.trim(),
            },
          })
        }),
      )

      return {
        commands: commands.map(command => {
          const parameters = Array.isArray(command.parameters)
            ? (command.parameters as Command["parameters"])
            : ([] as Command["parameters"])

          return create(CommandSchema, {
            id: command.id,
            name: command.name,
            title: command.title,
            description: command.description ?? undefined,
            parameters: parameters.map(parameter =>
              create(CommandParameterSchema, {
                name: parameter.name,
                title: parameter.title,
                description: parameter.description,
                type: parameter.type,
                required: parameter.required === true,
                rest: parameter.rest === true,
              }),
            ),
            protected: command.isProtected,
            callbackEndpoint: command.callbackEndpoint,
          })
        }),
      }
    },
  }
}
