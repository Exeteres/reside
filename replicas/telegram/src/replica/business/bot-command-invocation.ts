import type { JsonObject } from "@bufbuild/protobuf"
import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type { PermissionRequestServiceClient } from "@reside/api/access/request.v1"
import type {
  CommandHandlerServiceClient,
  CommandInvocationJson,
} from "@reside/api/interaction/command.v1"
import type { CommandParameterTypeJson } from "@reside/api/interaction/definition.v1"
import type { PrismaClient } from "../../database"
import { fromJson } from "@bufbuild/protobuf"
import { CommandInvocationSchema } from "@reside/api/interaction/command.v1"
import { CommandParameterType } from "@reside/api/interaction/definition.v1"
import { strings } from "../../locale"
import { canInvokeCommand, requestCommandInvokePermission } from "./authorization"
import {
  parseCommandInvocation,
  parseCommandParameters,
  parseStoredCommandParameters,
} from "./bot-command"
import { mapReplicaCallErrorMessage } from "./bot-replica-call"

export async function handleCommandInvocation(args: {
  prisma: PrismaClient
  authzService: AuthzServiceClient
  permissionRequestService: PermissionRequestServiceClient
  getCommandHandlerClient: (callbackEndpoint: string) => CommandHandlerServiceClient
  chatId: number
  userId: number
  messageId: number
  text: string
  interactionContext: {
    token: string
    title: string
  }
  sendSystemMessage: (input: { text: string; replyToMessageId: number }) => Promise<void>
}): Promise<void> {
  const commandInvocation = parseCommandInvocation(args.text)
  if (!commandInvocation) {
    return
  }

  const commandDefinition = await args.prisma.command.findUnique({
    where: {
      name: commandInvocation.name,
    },
  })

  if (!commandDefinition) {
    await args.sendSystemMessage({
      text: strings.worker.bot.commandNotFound(commandInvocation.name),
      replyToMessageId: args.messageId,
    })
    return
  }

  if (commandDefinition.isProtected) {
    const permission = await canInvokeCommand({
      authzService: args.authzService,
      userId: args.userId,
      commandName: commandDefinition.name,
    })

    if (!permission.authorized) {
      if (permission.checked) {
        await requestCommandInvokePermission({
          permissionRequestService: args.permissionRequestService,
          userId: args.userId,
          commandName: commandDefinition.name,
        })
      }

      await args.sendSystemMessage({
        text: strings.common.accessDenied,
        replyToMessageId: args.messageId,
      })
      return
    }
  }

  let parameters: Record<string, unknown>
  try {
    parameters = parseCommandParameters(commandDefinition.parameters, commandInvocation.parameters)
  } catch (error) {
    await args.sendSystemMessage({
      text: error instanceof Error ? error.message : String(error),
      replyToMessageId: args.messageId,
    })
    return
  }

  try {
    const commandParameters = parseStoredCommandParameters(commandDefinition.parameters).map(
      parameter => ({
        name: parameter.name,
        title: parameter.title,
        description: parameter.description,
        type: toCommandParameterTypeJson(parameter.type),
        required: parameter.required,
        rest: parameter.rest,
      }),
    )

    const invocation: CommandInvocationJson = {
      invocationId: `${args.chatId}:${args.messageId}`,
      command: {
        id: commandDefinition.id,
        name: commandDefinition.name,
        title: commandDefinition.title,
        description: commandDefinition.description ?? undefined,
        parameters: commandParameters,
        protected: commandDefinition.isProtected,
        callbackEndpoint: commandDefinition.callbackEndpoint,
      },
      context: args.interactionContext,
      parameters: toInvocationParametersJson(parameters),
      subjectId: `telegram:${args.userId}`,
    }

    await args
      .getCommandHandlerClient(commandDefinition.callbackEndpoint)
      .invokeCommand(fromJson(CommandInvocationSchema, invocation))
  } catch (error) {
    const mappedMessage = mapReplicaCallErrorMessage(error, {
      deadMessage: strings.worker.bot.commandReplicaUnavailable,
      brokenMessage: strings.worker.bot.commandReplicaBroken,
    })

    await args.sendSystemMessage({
      text: mappedMessage,
      replyToMessageId: args.messageId,
    })
  }
}

function toInvocationParametersJson(parameters: Record<string, unknown>): JsonObject {
  const json: JsonObject = {}

  for (const [key, value] of Object.entries(parameters)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      json[key] = value
    }
  }

  return json
}

function toCommandParameterTypeJson(type: CommandParameterType): CommandParameterTypeJson {
  if (type === CommandParameterType.INTEGER) {
    return "COMMAND_PARAMETER_TYPE_INTEGER"
  }

  if (type === CommandParameterType.BOOLEAN) {
    return "COMMAND_PARAMETER_TYPE_BOOLEAN"
  }

  return "COMMAND_PARAMETER_TYPE_STRING"
}
