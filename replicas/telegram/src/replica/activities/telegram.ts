import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type { PermissionRequestServiceClient } from "@reside/api/access/request.v1"
import type { DiscoveryServiceClient } from "@reside/api/alpha/discovery.v1"
import type { OperationServiceClient } from "@reside/api/common/operation.v1"
import type { GatewayServiceClient } from "@reside/api/infra/gateway.v1"
import type { ResideCrypto } from "@reside/common/encryption"
import type { Operation, PrismaClient } from "../../database"
import type { ApprovalActionName, TelegramActivities } from "../../definitions"
import { createHash } from "node:crypto"
import { fromJson } from "@bufbuild/protobuf"
import { CoreV1Api } from "@kubernetes/client-node"
import { ReplicaService } from "@reside/api/alpha/replica.v1"
import {
  CommandHandlerService,
  type CommandHandlerServiceClient,
  CommandInvocationSchema,
} from "@reside/api/interaction/command.v1"
import {
  type CommandParameterJson,
  CommandParameterType,
  type CommandParameterTypeJson,
} from "@reside/api/interaction/definition.v1"
import {
  NaturalLanguageService,
  type NaturalLanguageServiceClient,
} from "@reside/api/interaction/nls.v1"
import {
  createChannel,
  createClient,
  defineGateway,
  type GenericOperationService,
  getReplicaNamespace,
  kubeConfig,
  logger,
} from "@reside/common"
import { alphaReplica, WellKnownPermissions } from "@reside/registry"
import { encryptedStringSchema, TELEGRAM_GATEWAY_NAME } from "../../definitions"
import { strings } from "../../locale"
import { updateAvatarVersionTag } from "../business/avatar"
import { createTelegramBotClient } from "../business/bot-client"
import { createWebhookUrl } from "../business/bot-runtime"
import { loadTelegramConfigState } from "../business/config"
import { createEcidTextSubstitutor } from "../business/ecid-substitution"
import { loadTelegramSecretState, TELEGRAM_BOT_TOKEN_SECRET_KEY } from "../business/secret"

type TelegramActivityServices = {
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
  discoveryService: DiscoveryServiceClient
  authzService: AuthzServiceClient
  permissionRequestService: PermissionRequestServiceClient
  gatewayService: GatewayServiceClient
  infraOperationService: OperationServiceClient
  crypto: ResideCrypto
}

export function createTelegramActivities({
  prisma,
  operationService,
  discoveryService,
  authzService,
  permissionRequestService,
  gatewayService,
  infraOperationService,
  crypto,
}: TelegramActivityServices): TelegramActivities {
  const ecidSubstitutor = createEcidTextSubstitutor(crypto)

  const commandHandlerClients = new Map<string, CommandHandlerServiceClient>()
  const nlsClients = new Map<string, NaturalLanguageServiceClient>()

  const namespace = getReplicaNamespace()
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)
  let webhookUrlPromise: Promise<string> | undefined

  const loadWebhookUrl = async (): Promise<string> => {
    if (webhookUrlPromise === undefined) {
      webhookUrlPromise = (async () => {
        const { endpoint } = await defineGateway({
          services: {
            gatewayService,
            infraOperationService,
          },
          name: TELEGRAM_GATEWAY_NAME,
          title: strings.bootstrap.gateway.title,
          description: strings.bootstrap.gateway.description,
        })

        return createWebhookUrl(endpoint)
      })()
    }

    return await webhookUrlPromise
  }

  const getCommandHandlerClient = (callbackEndpoint: string): CommandHandlerServiceClient => {
    const existingClient = commandHandlerClients.get(callbackEndpoint)
    if (existingClient) {
      return existingClient
    }

    const createdClient = createClient(CommandHandlerService, createChannel(callbackEndpoint))
    commandHandlerClients.set(callbackEndpoint, createdClient)

    return createdClient
  }

  const getNaturalLanguageClient = (endpoint: string): NaturalLanguageServiceClient => {
    const existingClient = nlsClients.get(endpoint)
    if (existingClient) {
      return existingClient
    }

    const createdClient = createClient(NaturalLanguageService, createChannel(endpoint))
    nlsClients.set(endpoint, createdClient)

    return createdClient
  }

  return {
    async prepareCommandInvocation(input) {
      const commandInvocation = parseCommandInvocation(input.text)
      if (!commandInvocation) {
        return {
          kind: "reply",
          text: strings.worker.bot.commandNotFound(input.text),
        }
      }

      const commandDefinition = await prisma.command.findUnique({
        where: {
          name: commandInvocation.name,
        },
      })

      if (!commandDefinition) {
        return {
          kind: "reply",
          text: strings.worker.bot.commandNotFound(commandInvocation.name),
        }
      }

      if (commandDefinition.isProtected) {
        const subjectId = `telegram:${input.userId}`
        const check = await authzService.checkPermission({
          permissionName: WellKnownPermissions.TELEGRAM_COMMAND_INVOKE,
          subjectId,
          scope: commandDefinition.name,
        })

        if (!check.authorized) {
          await permissionRequestService.requestPermissions({
            subjectId,
            reason: strings.worker.authorization.autoRequestReason(commandDefinition.name),
            permissionSetName: `auto-request:${WellKnownPermissions.TELEGRAM_COMMAND_INVOKE}:${commandDefinition.name}`,
            items: [
              {
                permissionName: WellKnownPermissions.TELEGRAM_COMMAND_INVOKE,
                scope: commandDefinition.name,
              },
            ],
          })

          return {
            kind: "reply",
            text: strings.common.accessDenied,
          }
        }
      }

      let parameters: Record<string, string | number | boolean>
      try {
        parameters = parseCommandParameters(
          commandDefinition.parameters,
          commandInvocation.parameters,
        )
      } catch (error) {
        return {
          kind: "reply",
          text: error instanceof Error ? error.message : String(error),
        }
      }

      return {
        kind: "invoke",
        callbackEndpoint: commandDefinition.callbackEndpoint,
        invocation: {
          invocationId: `${input.chatId}:${input.messageId}`,
          command: {
            id: commandDefinition.id,
            name: commandDefinition.name,
            title: commandDefinition.title,
            description: commandDefinition.description ?? undefined,
            parameters: toCommandParameterJsonList(commandDefinition.parameters),
            protected: commandDefinition.isProtected,
            callbackEndpoint: commandDefinition.callbackEndpoint,
          },
          context: input.interactionContext,
          parameters,
          subjectId: `telegram:${input.userId}`,
        },
      }
    },

    async sendTelegramMessage(input) {
      const bot = createTelegramBotClient(input.token, {
        role: "activity.manager-message",
      })

      await bot.api.sendMessage(input.chatId, input.text, {
        parse_mode: "HTML",
        link_preview_options: {
          is_disabled: true,
        },
        reply_parameters: {
          message_id: input.replyToMessageId,
        },
      })
    },

    async resolveNlsTarget(input) {
      if (input.mentionedUsername) {
        const mentionedAvatar = await prisma.avatar.findFirst({
          where: {
            managedBotUsername: {
              equals: input.mentionedUsername,
              mode: "insensitive",
            },
          },
          select: {
            replicaName: true,
            tokenEcid: true,
            managedBotUsername: true,
          },
        })

        if (mentionedAvatar) {
          return {
            found: true,
            replicaName: mentionedAvatar.replicaName,
            avatarToken: await crypto.decrypt(encryptedStringSchema, mentionedAvatar.tokenEcid),
            managedBotUsername: mentionedAvatar.managedBotUsername,
          }
        }
      }

      if (input.repliedUsername) {
        const repliedAvatar = await prisma.avatar.findFirst({
          where: {
            managedBotUsername: {
              equals: input.repliedUsername,
              mode: "insensitive",
            },
          },
          select: {
            replicaName: true,
            tokenEcid: true,
            managedBotUsername: true,
          },
        })

        if (repliedAvatar) {
          return {
            found: true,
            replicaName: repliedAvatar.replicaName,
            avatarToken: await crypto.decrypt(encryptedStringSchema, repliedAvatar.tokenEcid),
            managedBotUsername: repliedAvatar.managedBotUsername,
          }
        }
      }

      if (input.currentReplicaName) {
        const currentAvatar = await prisma.avatar.findUnique({
          where: {
            replicaName: input.currentReplicaName,
          },
          select: {
            replicaName: true,
            tokenEcid: true,
            managedBotUsername: true,
          },
        })

        if (currentAvatar) {
          return {
            found: true,
            replicaName: currentAvatar.replicaName,
            avatarToken: await crypto.decrypt(encryptedStringSchema, currentAvatar.tokenEcid),
            managedBotUsername: currentAvatar.managedBotUsername,
          }
        }
      }

      return {
        found: false,
      }
    },

    async ensureNlsPermission(input) {
      const check = await authzService.checkPermission({
        permissionName: WellKnownPermissions.INTERACTION_NLS_ASK,
        subjectId: input.fromSubjectId,
        scope: input.toSubjectId,
      })

      if (check.authorized) {
        return { authorized: true }
      }

      await permissionRequestService.requestPermissions({
        subjectId: input.fromSubjectId,
        reason: strings.worker.authorization.autoRequestNlsReason(input.toSubjectId),
        permissionSetName: `auto-request:${WellKnownPermissions.INTERACTION_NLS_ASK}:${input.toSubjectId}`,
        items: [
          {
            permissionName: WellKnownPermissions.INTERACTION_NLS_ASK,
            scope: input.toSubjectId,
          },
        ],
      })

      return { authorized: false }
    },

    async setNlsInProgressReaction(input) {
      const reactionBot = createTelegramBotClient(input.avatarToken ?? input.managerToken, {
        role: "activity.nls-reaction",
      })

      await reactionBot.api.setMessageReaction(input.chatId, input.messageId, [
        {
          type: "emoji",
          emoji: "👀",
        },
      ])
    },

    async sendNlsReply(input) {
      const replyBot = createTelegramBotClient(input.avatarToken ?? input.managerToken, {
        role: "activity.nls-reply",
      })

      const text = await ecidSubstitutor.substituteInText(input.text)

      await replyBot.api.sendMessage(input.chatId, text, {
        parse_mode: "HTML",
        link_preview_options: {
          is_disabled: true,
        },
        reply_parameters: {
          message_id: input.replyToMessageId,
        },
      })
    },

    async invokeReplicaCommand(input) {
      await getCommandHandlerClient(input.callbackEndpoint).invokeCommand(
        fromJson(CommandInvocationSchema, input.invocation),
      )
    },

    async askReplicaNls(input) {
      const endpointResponse = await discoveryService.getSubjectEndpoint({
        subjectId: input.toSubjectId,
      })

      const askResponse = await getNaturalLanguageClient(endpointResponse.endpoint).ask({
        text: input.prompt,
        subjectId: input.fromSubjectId,
      })

      return {
        text: askResponse.text,
      }
    },

    async getAvatarProvisionRequest(input) {
      const request = await prisma.avatarProvisionRequest.findUnique({
        where: {
          operationId: input.operationId,
        },
        select: {
          operationId: true,
          subjectId: true,
          replicaName: true,
          replicaTitle: true,
          expectedPrefix: true,
        },
      })

      if (!request) {
        throw new Error(
          `Avatar provisioning request for operation "${input.operationId}" was not found`,
        )
      }

      return request
    },

    async getAvatarProvisioningPromptLink(input) {
      const request = await prisma.avatarProvisionRequest.findUnique({
        where: {
          operationId: input.operationId,
        },
      })

      if (!request) {
        throw new Error(
          `Avatar provisioning request for operation "${input.operationId}" was not found`,
        )
      }

      const secretState = await loadTelegramSecretState(crypto)
      if (!secretState.botToken) {
        throw new Error(
          `Vault secret key "${TELEGRAM_BOT_TOKEN_SECRET_KEY}" must contain token value`,
        )
      }

      const managerBot = createTelegramBotClient(secretState.botToken, {
        role: "activity.manager",
      })
      const me = await managerBot.api.getMe()
      const managerBotUsername = me.username?.trim()
      if (!managerBotUsername) {
        throw new Error("Manager bot username is not available")
      }

      const requestLink = createManagedBotLink(
        managerBotUsername,
        request.expectedPrefix,
        request.replicaTitle,
      )

      return {
        link: requestLink,
      }
    },

    async completeAvatarProvisionOperation(input) {
      const request = await prisma.avatarProvisionRequest.findUnique({
        where: {
          operationId: input.operationId,
        },
      })

      if (!request) {
        throw new Error(
          `Avatar provisioning request for operation "${input.operationId}" was not found`,
        )
      }

      const secretState = await loadTelegramSecretState(crypto)
      if (!secretState.botToken) {
        throw new Error(
          `Vault secret key "${TELEGRAM_BOT_TOKEN_SECRET_KEY}" must contain token value`,
        )
      }

      const managerBot = createTelegramBotClient(secretState.botToken, {
        role: "activity.manager",
      })
      const managedBotId = parseManagedBotId(input.managedBotId)
      const replacement = await managerBot.api.replaceManagedBotToken(managedBotId)

      const avatarBot = createTelegramBotClient(replacement, {
        role: "activity.avatar",
      })

      await avatarBot.api.setWebhook(await loadWebhookUrl(), {
        secret_token: createWebhookSecret(replacement),
        drop_pending_updates: false,
        allowed_updates: ["callback_query"],
      })

      const tokenEcid = await crypto.encrypt(replacement)

      await prisma.$transaction(async tx => {
        const avatar = await tx.avatar.upsert({
          where: {
            subjectId: request.subjectId,
          },
          create: {
            subjectId: request.subjectId,
            replicaName: request.replicaName,
            replicaTitle: request.replicaTitle,
            managedBotId: input.managedBotId,
            managedBotUsername: input.managedBotUsername,
            createdByUserId: request.createdByUserId,
            tokenEcid,
          },
          update: {
            replicaTitle: request.replicaTitle,
            managedBotId: input.managedBotId,
            managedBotUsername: input.managedBotUsername,
            createdByUserId: request.createdByUserId,
            tokenEcid,
          },
          select: {
            id: true,
          },
        })

        await tx.avatarProvisionRequest.update({
          where: {
            operationId: input.operationId,
          },
          data: {
            avatarId: avatar.id,
          },
        })
      })

      // try to fetch the replica version and update avatar's version tag
      try {
        const alphaClient = createClient(ReplicaService, createChannel(alphaReplica.endpoint))
        const replicaResp = await alphaClient.getReplica({ name: request.replicaName })
        const version = replicaResp?.replica?.version

        if (version) {
          const configState = await loadTelegramConfigState(coreApi, namespace)
          if (configState.systemChatId) {
            await updateAvatarVersionTag(prisma, createTelegramBotClient, {
              managerBotToken: secretState.botToken,
              systemChatId: configState.systemChatId,
              replicaName: request.replicaName,
              newVersion: version,
            })
          }
        }
      } catch (error) {
        logger.warn(
          { error, replica: request.replicaName },
          "failed to fetch replica version or update avatar tag",
        )
      }

      await operationService.setCompleted(input.operationId)
    },

    async failAvatarProvisionOperation(input) {
      await prisma.operation.update({
        where: {
          id: input.operationId,
        },
        data: {
          status: "FAILED",
          failureReason: input.reason,
          failureMessage: input.message,
          resolvedAt: new Date(),
        },
      })
    },

    async completeApprovalOperation(input) {
      const mappedResult = mapActionToResult(input.actionName)

      await prisma.$transaction(async tx => {
        await tx.approvalRequest.update({
          where: {
            operationId: input.operationId,
          },
          data: {
            result: mappedResult.result,
            resolution: mappedResult.resolution,
            respondedAt: new Date(),
          },
        })
      })

      await operationService.setCompleted(input.operationId)
    },

    async failApprovalOperation(input) {
      await prisma.operation.update({
        where: {
          id: input.operationId,
        },
        data: {
          status: "FAILED",
          failureReason: input.reason,
          failureMessage: input.message,
          resolvedAt: new Date(),
        },
      })
    },
  }
}

type ParsedCommandParameter = {
  name: string
  title: string
  description?: string
  type: CommandParameterType
  required: boolean
  rest: boolean
}

function parseCommandInvocation(text: string): {
  name: string
  parameters: string[]
} | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith("/")) {
    return null
  }

  const parts = trimmed.slice(1).split(/\s+/).filter(Boolean)
  const [rawCommand, ...args] = parts
  if (!rawCommand) {
    return null
  }

  const commandName = rawCommand.split("@")[0]?.trim()
  if (!commandName) {
    return null
  }

  return {
    name: commandName,
    parameters: args,
  }
}

function parseStoredCommandParameters(raw: unknown): ParsedCommandParameter[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
    )
    .map(entry => ({
      name: typeof entry.name === "string" ? entry.name : "",
      title: typeof entry.title === "string" ? entry.title : "",
      description: typeof entry.description === "string" ? entry.description : undefined,
      type:
        typeof entry.type === "number" &&
        (entry.type === CommandParameterType.STRING ||
          entry.type === CommandParameterType.INTEGER ||
          entry.type === CommandParameterType.BOOLEAN)
          ? entry.type
          : CommandParameterType.STRING,
      required: entry.required === true,
      rest: entry.rest === true,
    }))
    .filter(parameter => parameter.name.length > 0 && parameter.title.length > 0)
}

function toCommandParameterJsonList(raw: unknown): CommandParameterJson[] {
  return parseStoredCommandParameters(raw).map(parameter => ({
    name: parameter.name,
    title: parameter.title,
    description: parameter.description,
    type: toCommandParameterTypeJson(parameter.type),
    required: parameter.required,
    rest: parameter.rest,
  }))
}

function toCommandParameterTypeJson(type: CommandParameterType): CommandParameterTypeJson {
  switch (type) {
    case CommandParameterType.STRING:
      return "COMMAND_PARAMETER_TYPE_STRING"
    case CommandParameterType.INTEGER:
      return "COMMAND_PARAMETER_TYPE_INTEGER"
    case CommandParameterType.BOOLEAN:
      return "COMMAND_PARAMETER_TYPE_BOOLEAN"
  }
}

function parseCommandParameters(
  rawParameters: unknown,
  values: string[],
): Record<string, string | number | boolean> {
  const definitions = parseStoredCommandParameters(rawParameters)
  const params: Record<string, string | number | boolean> = {}
  let valueIndex = 0

  for (const definition of definitions) {
    if (definition.rest === true) {
      const restValue = values.slice(valueIndex).join(" ")
      if (restValue.length > 0) {
        params[definition.name] = parseCommandParameterValue(definition, restValue)
      } else if (definition.required === true) {
        throw new Error(strings.worker.bot.parameterRequired(definition.name))
      }

      valueIndex = values.length
      continue
    }

    const rawValue = values[valueIndex]
    if (rawValue === undefined) {
      if (definition.required === true) {
        throw new Error(strings.worker.bot.parameterRequired(definition.name))
      }

      valueIndex += 1
      continue
    }

    params[definition.name] = parseCommandParameterValue(definition, rawValue)
    valueIndex += 1
  }

  return params
}

function parseCommandParameterValue(
  definition: ParsedCommandParameter,
  value: string,
): string | number | boolean {
  switch (definition.type) {
    case CommandParameterType.STRING:
      return value
    case CommandParameterType.INTEGER: {
      const numberValue = Number.parseInt(value, 10)
      if (Number.isNaN(numberValue)) {
        throw new Error(strings.worker.bot.parameterMustBeInteger(definition.name))
      }

      return numberValue
    }
    case CommandParameterType.BOOLEAN: {
      const normalized = value.trim().toLowerCase()
      if (["true", "1", "yes", "y", "on"].includes(normalized)) {
        return true
      }

      if (["false", "0", "no", "n", "off"].includes(normalized)) {
        return false
      }

      throw new Error(strings.worker.bot.parameterMustBeBoolean(definition.name))
    }
  }
}

function parseManagedBotId(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid managed bot id "${value}"`)
  }

  return parsed
}

function createManagedBotLink(
  managerBotUsername: string,
  expectedPrefix: string,
  suggestedBotName: string,
): string {
  const suggestedBotUsername = `${expectedPrefix}_bot`
  return `https://t.me/newbot/${managerBotUsername}/${suggestedBotUsername}?name=${encodeURIComponent(suggestedBotName)}`
}

function mapActionToResult(actionName: ApprovalActionName): {
  result: "ESCALATED" | "APPROVED" | "REJECTED"
  resolution: string
} {
  switch (actionName) {
    case "approve":
      return {
        result: "APPROVED",
        resolution: strings.worker.activities.approvalResolutionApproved,
      }
    case "reject":
      return {
        result: "REJECTED",
        resolution: strings.worker.activities.approvalResolutionRejected,
      }
    case "escalate":
      return {
        result: "ESCALATED",
        resolution: strings.worker.activities.approvalResolutionEscalated,
      }
  }
}

function createWebhookSecret(token: string): string {
  return createHash("sha256").update(`telegram-webhook:${token}`).digest("hex")
}
