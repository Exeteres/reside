import type { ConnectRouter } from "@connectrpc/connect"
import type { FastifyInstance } from "fastify"
import { create } from "@bufbuild/protobuf"
import { Code, ConnectError, type HandlerContext } from "@connectrpc/connect"
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { defineTool, type SessionConfig } from "@github/copilot-sdk"
import { waitForOperationSuccess } from "@reside/api"
import { DiscoveryService, type DiscoveryServiceClient } from "@reside/api/alpha/discovery.v1"
import { ReplicaService, type ReplicaServiceClient } from "@reside/api/alpha/replica.v1"
import {
  AskResponseSchema,
  NaturalLanguageService,
  type NaturalLanguageServiceClient,
  type NaturalLanguageServiceImplementation,
} from "@reside/api/interaction/nls.v1"
import { alphaReplica, WellKnownPermissions } from "@reside/registry"
import { z } from "zod"
import { createChannel, createClient } from "../api"
import { authenticate } from "../auth"
import { getReplicaName } from "../kubernetes"
import { logger } from "../logger"
import { registerGracefulShutdown } from "../utils"
import {
  createLanguageEngine,
  type LanguageEngine,
  type LanguageEngineServices,
  type LanguageEngineStorageCredentials,
} from "./engine"

const NLS_DEFAULT_MODEL = "gpt-5-mini"
const NLS_SESSION_PREFIX = "sessions"

export type SetupLanguageSubsystemOptions = {
  services: LanguageEngineServices
  server: FastifyInstance
  title: string
  description: string
  mission: string
  storageCredentials?: LanguageEngineStorageCredentials
  tools?: NonNullable<SessionConfig["tools"]>
}

export async function setupLanguageSubsystem({
  services,
  server,
  title,
  description,
  mission,
  storageCredentials,
  tools,
}: SetupLanguageSubsystemOptions): Promise<void> {
  let subsystem: LanguageEngine
  const alphaChannel = createChannel(alphaReplica.endpoint)
  const alphaDiscoveryService = createClient(DiscoveryService, alphaChannel)
  const alphaReplicaService = createClient(ReplicaService, alphaChannel)

  try {
    subsystem = await createLanguageEngine({
      services,
      model: NLS_DEFAULT_MODEL,
      sessionPrefix: NLS_SESSION_PREFIX,
      systemPrompt: buildReplicaSystemPrompt({
        replicaName: getReplicaName(),
        title,
        description,
        mission,
      }),
      allowedSystemTools: ["ask_replica", "list_replicas"],
      storageCredentials,
      tools: [
        createAskReplicaTool({
          services,
          alphaDiscoveryService,
        }),
        createListReplicasTool({
          alphaReplicaService,
        }),
        ...(tools ?? []),
      ],
    })
  } catch (error) {
    logger.warn(
      { error: normalizeError(error) },
      "nls initialization skipped because dependencies are unavailable",
    )

    return
  }

  registerGracefulShutdown(async () => {
    await subsystem.stop()
  })

  await server.register(fastifyConnectPlugin, {
    routes(router: ConnectRouter) {
      router.service(NaturalLanguageService, createNaturalLanguageService(services, subsystem))
    },
  })
}

function createNaturalLanguageService(
  services: LanguageEngineServices,
  subsystem: LanguageEngine,
): NaturalLanguageServiceImplementation {
  return {
    async ask(request, context: HandlerContext) {
      const requester = await authenticate(context)
      const effectiveFromSubjectId = request.subjectId ?? requester.subjectId

      if (!effectiveFromSubjectId) {
        throw new ConnectError("subject_id is required", Code.InvalidArgument)
      }

      assertSubjectId(effectiveFromSubjectId, "subject_id")

      if (request.subjectId !== undefined && request.subjectId !== requester.subjectId) {
        const { realm } = splitSubjectId(effectiveFromSubjectId)

        const impersonationCheck = await services.authzService.checkPermission({
          permissionName: WellKnownPermissions.INTERACTION_NLS_IMPERSONATE,
          subjectId: requester.subjectId,
          scope: realm,
        })

        if (!impersonationCheck.authorized) {
          throw new ConnectError(
            `Subject "${requester.subjectId}" is not allowed to impersonate realm "${realm}"`,
            Code.PermissionDenied,
          )
        }
      }

      const localSubjectId = `replica:${getReplicaName()}`
      const askCheck = await services.authzService.checkPermission({
        permissionName: WellKnownPermissions.INTERACTION_NLS_ASK,
        subjectId: effectiveFromSubjectId,
        scope: localSubjectId,
      })

      if (!askCheck.authorized) {
        throw new ConnectError(
          `Subject "${effectiveFromSubjectId}" is not allowed to ask "${localSubjectId}"`,
          Code.PermissionDenied,
        )
      }

      const prompt = request.text.trim()
      if (prompt.length === 0) {
        throw new ConnectError("text must not be empty", Code.InvalidArgument)
      }

      const text = await subsystem.ask(effectiveFromSubjectId, prompt)
      return create(AskResponseSchema, { text })
    },
  }
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}

function assertSubjectId(value: string, fieldName: string): void {
  const normalized = value.trim()
  if (normalized.length === 0) {
    throw new ConnectError(`${fieldName} must not be empty`, Code.InvalidArgument)
  }

  const segments = normalized.split(":")
  if (segments.length !== 2 || segments[0]?.length === 0 || segments[1]?.length === 0) {
    throw new ConnectError(`${fieldName} must be in format "{realm}:{name}"`, Code.InvalidArgument)
  }
}

function splitSubjectId(subjectId: string): { realm: string; name: string } {
  const [realm = "", name = ""] = subjectId.split(":")
  return { realm, name }
}

function buildReplicaSystemPrompt(args: {
  replicaName: string
  title: string
  description: string
  mission: string
}): string {
  const title = args.title.trim()
  const description = args.description.trim()

  return [
    "You are a specialized assistant behind a ReSide replica.",
    `Replica name: ${args.replicaName}`,
    `Replica title: ${title.length > 0 ? title : args.replicaName}`,
    `Replica description: ${description.length > 0 ? description : "No description provided."}`,
    `Replica mission: ${args.mission}`,
    "Instructions:",
    "- You are a female replica persona.",
    "- Reply in the same language as the user request.",
    "- Use a friendly and cute voice tone, but keep it moderate and professional.",
    "- Do not use emojis.",
    "- Keep replies concise and practical.",
    "- Use available tools when they improve answer quality or correctness.",
    "- If another replica can help better, use ask_replica and include that result.",
    "- list_replicas shows available replicas and their endpoints.",
    "- use internet tools to provide up-to-date information.",
    "- use bash and other tools to perform complex tasks and complex calculations.",
  ].join("\n")
}

function createAskReplicaTool(args: {
  services: LanguageEngineServices
  alphaDiscoveryService: DiscoveryServiceClient
}) {
  const nlsClients = new Map<string, NaturalLanguageServiceClient>()

  return defineTool("ask_replica", {
    description:
      "Asks another replica by technical name and returns its natural language response.",
    parameters: z.object({
      replicaName: z.string().min(1),
      prompt: z.string().min(1),
    }),
    handler: async ({ replicaName, prompt }) => {
      const normalizedReplicaName = replicaName.trim()
      const currentReplicaSubjectId = `replica:${getReplicaName()}`

      try {
        if (!/^[a-z0-9-]+$/.test(normalizedReplicaName)) {
          throw new Error("replicaName must match /^[a-z0-9-]+$/")
        }

        const toSubjectId = `replica:${normalizedReplicaName}`
        const permissionRequest = await args.services.permissionRequestService.requestPermissions({
          subjectId: currentReplicaSubjectId,
          reason: `Для запроса через ask_replica к ${toSubjectId}`,
          permissionSetName: `nls:ask-replica:${normalizedReplicaName}`,
          items: [
            {
              permissionName: WellKnownPermissions.INTERACTION_NLS_ASK,
              scope: toSubjectId,
            },
          ],
        })

        if (permissionRequest.operation) {
          await waitForOperationSuccess(permissionRequest.operation, {
            operationService: args.services.accessOperationService,
          })
        }

        const endpointResponse = await args.alphaDiscoveryService.getSubjectEndpoint({
          subjectId: toSubjectId,
        })

        const endpoint = endpointResponse.endpoint.trim()
        if (endpoint.length === 0) {
          throw new Error(`Replica "${normalizedReplicaName}" has empty endpoint`)
        }

        let client = nlsClients.get(endpoint)
        if (!client) {
          client = createClient(NaturalLanguageService, createChannel(endpoint))
          nlsClients.set(endpoint, client)
        }

        const askResponse = await client.ask({
          text: prompt.trim(),
        })

        return {
          replicaName: normalizedReplicaName,
          response: askResponse.text,
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        logger.warn(
          {
            error: errorMessage,
            replicaName: normalizedReplicaName,
          },
          "nls ask_replica failed",
        )

        return {
          replicaName: normalizedReplicaName,
          response: `Failed to ask replica "${normalizedReplicaName}": ${errorMessage}`,
        }
      }
    },
  })
}

function createListReplicasTool(args: { alphaReplicaService: ReplicaServiceClient }) {
  return defineTool("list_replicas", {
    description: "Lists public metadata of all registered replicas.",
    parameters: z.object({}),
    handler: async () => {
      const response = await args.alphaReplicaService.listReplicas({})

      return {
        replicas: response.replicas.map(replica => ({
          id: replica.id,
          name: replica.name,
          title: replica.title,
          description: replica.description,
          internalEndpoint: replica.internalEndpoint,
          publicEndpoint: replica.publicEndpoint,
        })),
      }
    },
  })
}
