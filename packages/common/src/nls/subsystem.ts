import type { ConnectRouter } from "@connectrpc/connect"
import type { FastifyInstance } from "fastify"
import type { MemoryToolTagDefinitions } from "./memory"
import type { SessionConfig } from "./tool"
import { randomUUID } from "node:crypto"
import { create } from "@bufbuild/protobuf"
import { Code, ConnectError, type HandlerContext } from "@connectrpc/connect"
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { waitForOperationSuccess } from "@reside/api"
import { DiscoveryService, type DiscoveryServiceClient } from "@reside/api/alpha/discovery.v1"
import { ReplicaService, type ReplicaServiceClient } from "@reside/api/alpha/replica.v1"
import {
  AskResponseSchema,
  AskStreamResponseSchema,
  NaturalLanguageService,
  type NaturalLanguageServiceClient,
  type NaturalLanguageServiceImplementation,
} from "@reside/api/interaction/nls.v1"
import { alphaReplica, WellKnownPermissions } from "@reside/registry"
import OpenAI from "openai"
import { z } from "zod"
import { createChannel, createClient } from "../api"
import { authenticate } from "../auth"
import { crypto } from "../encryption"
import { getReplicaName } from "../kubernetes"
import { logger } from "../logger"
import { rhid } from "../rhid"
import { registerGracefulShutdown } from "../utils"
import {
  createLanguageEngine,
  type LanguageEngine,
  type LanguageEngineServices,
  type LanguageEngineStorageCredentials,
} from "./engine"
import { defineTool } from "./tool"

const NLS_DEFAULT_MODEL = "light"
const NLS_SESSION_PREFIX = "interactions"
const DATABASE_QUERY_MAX_ROWS = 100
const DATABASE_QUERY_MAX_VALUE_LENGTH = 2000

const llmSecretSchema = z.object({
  endpoint: z.string().trim().min(1),
  "api-key": z.string().trim().min(1),
  "light-model": z.string().trim().min(1),
  "smart-model": z.string().trim().min(1),
})

const sessionClassificationSchema = z.object({
  action: z.enum(["continue", "new"]),
})

export type SetupLanguageSubsystemOptions = {
  services: LanguageEngineServices
  server: FastifyInstance
  title: string
  description: string
  instructions: string
  tags?: MemoryToolTagDefinitions
  storageCredentials?: LanguageEngineStorageCredentials
  tools?: NonNullable<SessionConfig["tools"]>
}

export async function setupLanguageSubsystem({
  services,
  server,
  title,
  description,
  instructions,
  tags,
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
        instructions,
      }),
      tags,
      storageCredentials,
      tools: [
        createAskReplicaTool({
          services,
          alphaDiscoveryService,
        }),
        createListReplicasTool({
          alphaReplicaService,
        }),
        createQueryDatabaseTool({
          services,
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
      const { subjectId, prompt, subjectInfo, sessionReference } = await authorizeAskRequest(
        services,
        request,
        context,
      )
      const sessionId = await resolveRequestSessionId(prompt, sessionReference)
      const text = await subsystem.ask(sessionId, prompt, {
        systemPrompt: await buildRequestSystemPrompt(subjectId, subjectInfo),
      })
      return create(AskResponseSchema, { text, sessionId })
    },
    async *askStream(request, context: HandlerContext) {
      const { subjectId, prompt, subjectInfo, sessionReference } = await authorizeAskRequest(
        services,
        request,
        context,
      )
      const sessionId = await resolveRequestSessionId(prompt, sessionReference)
      yield create(AskStreamResponseSchema, { sessionId })

      const frameQueue: Array<{ text: string; reset: boolean }> = []
      let queueNotifier: (() => void) | undefined
      let streamCompleted = false
      let streamError: unknown

      const notifyQueue = () => {
        if (!queueNotifier) {
          return
        }

        queueNotifier()
        queueNotifier = undefined
      }

      const runStream = subsystem
        .askStream(
          sessionId,
          prompt,
          async frame => {
            frameQueue.push(frame)
            notifyQueue()
          },
          {
            systemPrompt: await buildRequestSystemPrompt(subjectId, subjectInfo),
          },
        )
        .catch(error => {
          streamError = error
        })
        .finally(() => {
          streamCompleted = true
          notifyQueue()
        })

      while (!streamCompleted || frameQueue.length > 0) {
        if (frameQueue.length === 0) {
          await new Promise<void>(resolve => {
            queueNotifier = resolve
          })
          continue
        }

        const frame = frameQueue.shift()
        if (!frame) {
          continue
        }

        yield create(AskStreamResponseSchema, {
          text: frame.text,
          reset: frame.reset,
          sessionId,
        })
      }

      await runStream

      if (streamError) {
        throw normalizeError(streamError)
      }
    },
    async clearSubjectContext(request, context: HandlerContext) {
      const subjectId = await authorizeClearSubjectContextRequest(services, request, context)
      await subsystem.clearContext(subjectId)
      return {}
    },
  }
}

async function authorizeAskRequest(
  services: LanguageEngineServices,
  request: {
    text: string
    subjectId?: string
    subjectInfo?: Record<string, string>
    sessionReference: {
      case: "sessionId" | "lastSessionId" | undefined
      value?: string
    }
  },
  context: HandlerContext,
): Promise<{
  subjectId: string
  prompt: string
  subjectInfo: Record<string, string>
  sessionReference: NlsSessionReference
}> {
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

  const subjectInfo = request.subjectInfo ?? {}

  return {
    subjectId: effectiveFromSubjectId,
    prompt,
    subjectInfo,
    sessionReference: parseSessionReference(request.sessionReference),
  }
}

type NlsSessionReference =
  | { type: "explicit"; sessionId: string }
  | { type: "last"; sessionId: string }
  | { type: "none" }

function parseSessionReference(input: {
  case: "sessionId" | "lastSessionId" | undefined
  value?: string
}): NlsSessionReference {
  if (input.case === "sessionId") {
    return { type: "explicit", sessionId: normalizeApiSessionId(input.value, "session_id") }
  }

  if (input.case === "lastSessionId") {
    return { type: "last", sessionId: normalizeApiSessionId(input.value, "last_session_id") }
  }

  return { type: "none" }
}

function normalizeApiSessionId(sessionId: string | undefined, fieldName: string): string {
  const normalized = sessionId?.trim() ?? ""
  if (normalized.length === 0) {
    throw new ConnectError(`${fieldName} must not be empty`, Code.InvalidArgument)
  }

  return normalized
}

async function resolveRequestSessionId(
  prompt: string,
  sessionReference: NlsSessionReference,
): Promise<string> {
  if (sessionReference.type === "explicit") {
    return sessionReference.sessionId
  }

  if (sessionReference.type === "none") {
    return randomUUID()
  }

  const shouldContinue = await classifyShouldContinueLastSession(prompt)
  if (shouldContinue) {
    return sessionReference.sessionId
  }

  return randomUUID()
}

async function classifyShouldContinueLastSession(prompt: string): Promise<boolean> {
  try {
    const llmSecret = await crypto.getSecret(llmSecretSchema, "llm")
    const client = new OpenAI({
      apiKey: llmSecret["api-key"],
      baseURL: llmSecret.endpoint,
    })

    const response = await client.chat.completions.create({
      model: llmSecret["light-model"],
      messages: [
        {
          role: "system",
          content:
            "Classify whether a user Telegram message is standalone or needs previous dialog context. " +
            'Return only a valid JSON object with shape {"action":"continue"} or {"action":"new"}. ' +
            "Use continue only when the message contains pronouns, ellipsis, direct follow-up wording, corrections, or references that require previous context. " +
            "Use new for standalone questions, commands, greetings, or ambiguous messages.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    })

    const content = response.choices[0]?.message.content
    if (content === null || content === undefined || content.trim().length === 0) {
      return false
    }

    const classification = sessionClassificationSchema.parse(JSON.parse(content))
    logger.info(
      'nls session continuation classified action="%s" prompt_length="%s"',
      classification.action,
      String(prompt.length),
    )

    return classification.action === "continue"
  } catch (error) {
    logger.warn({ error: normalizeError(error) }, "nls session continuation classification failed")

    return false
  }
}

async function authorizeClearSubjectContextRequest(
  services: LanguageEngineServices,
  request: {
    subjectId: string
  },
  context: HandlerContext,
): Promise<string> {
  const requester = await authenticate(context)
  const subjectId = request.subjectId.trim()
  if (subjectId.length === 0) {
    throw new ConnectError("subject_id is required", Code.InvalidArgument)
  }

  assertSubjectId(subjectId, "subject_id")

  const { realm } = splitSubjectId(subjectId)
  const clearCheck = await services.authzService.checkPermission({
    permissionName: WellKnownPermissions.INTERACTION_NLS_CLEAR_SUBJECT_CONTEXT,
    subjectId: requester.subjectId,
    scope: realm,
  })

  if (!clearCheck.authorized) {
    throw new ConnectError(
      `Subject "${requester.subjectId}" is not allowed to clear NLS context for realm "${realm}"`,
      Code.PermissionDenied,
    )
  }

  return subjectId
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
  instructions: string
}): string {
  const title = args.title.trim()
  const description = args.description.trim()
  const instructions = args.instructions.trim()

  return [
    "You are a specialized assistant behind a ReSide replica.",
    `Replica name: ${args.replicaName}`,
    `Replica title: ${title.length > 0 ? title : args.replicaName}`,
    `Replica description: ${description.length > 0 ? description : "No description provided."}`,
    "Instructions:",
    "- You are a female replica persona.",
    "- Reply in the same language as the user request.",
    "- Use a friendly and cute voice tone, but keep it moderate and professional.",
    "- Do not use emojis.",
    "- Keep replies concise and practical.",
    "- Use available tools when they improve answer quality or correctness.",
    "- If another replica can help better, use reside_ask_replica and include that result.",
    "- reside_list_replicas shows available replicas and their endpoints.",
    "- use internet tools to provide up-to-date information.",
    "- use bash and other tools to perform complex tasks and complex calculations.",
    "- You may see ECIDs in the form enc:<replica>:<id>; treat them as opaque encrypted content identifiers.",
    "- You can include ECIDs in responses when the user needs to receive or pass around protected content.",
    "- Do not try to decrypt, inspect, transform, summarize, translate, or rewrite ECID content.",
    "- If the user asks to transform content identified only by an ECID, say that you have no access to the actual content and can only return or route the ECID unchanged.",
    ...(instructions.length > 0 ? ["Replica-specific instructions:", instructions] : []),
  ].join("\n")
}

async function buildRequestSystemPrompt(
  subjectId: string,
  subjectInfo: Record<string, string>,
): Promise<string> {
  const subjectContext =
    splitSubjectId(subjectId).realm === "replica" ? subjectId : hashSubjectId(subjectId)
  const subjectInfoLines = Object.entries(subjectInfo)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `- ${key}: ${value}`)

  return [
    "Current interaction context:",
    `- Subject ID for this interaction: ${subjectContext}`,
    "- If the subject ID is an RHID, treat it as an opaque stable identifier for this user in this replica and never claim to know the underlying plaintext subject.",
    "- If your answer can use ECIDs directly without complex transformations, reply naturally as if you know the value and provide ECIDs in place of plaintext values.",
    "- For simple identity-style questions (for example: who is them), answer directly using the available ECID-based references instead of saying that the value is inaccessible.",
    "- Subject info provided by the caller (list all keys and values exactly as provided):",
    ...(subjectInfoLines.length > 0 ? subjectInfoLines : ["- none"]),
  ].join("\n")
}

function hashSubjectId(subjectId: string): string {
  try {
    return rhid(subjectId)
  } catch (error) {
    logger.warn(
      {
        error: normalizeError(error),
      },
      "nls could not hash interaction subject id",
    )

    return "unavailable"
  }
}

function createAskReplicaTool(args: {
  services: LanguageEngineServices
  alphaDiscoveryService: DiscoveryServiceClient
}) {
  const nlsClients = new Map<string, NaturalLanguageServiceClient>()

  return defineTool("reside_ask_replica", {
    description:
      "Asks another replica by technical name and returns its natural language response.",
    parameters: z.object({
      replicaName: z.string().min(1),
      prompt: z.string().min(1),
    }),
    handler: async ({ replicaName, prompt }) => {
      const normalizedReplicaName = replicaName.trim()
      const currentReplicaSubjectId = `replica:${getReplicaName()}`

      if (!/^[a-z0-9-]+$/.test(normalizedReplicaName)) {
        throw new Error("replicaName must match /^[a-z0-9-]+$/")
      }

      const toSubjectId = `replica:${normalizedReplicaName}`
      const permissionRequest = await args.services.permissionRequestService.requestPermissions({
        subjectId: currentReplicaSubjectId,
        reason: `Для запроса через reside_ask_replica к ${toSubjectId}`,
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
    },
  })
}

function createListReplicasTool(args: { alphaReplicaService: ReplicaServiceClient }) {
  return defineTool("reside_list_replicas", {
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

function createQueryDatabaseTool(args: { services: LanguageEngineServices }) {
  return defineTool("reside_query_database", {
    description:
      "Runs an arbitrary SQL query against this replica database and returns rows as structured data.",
    parameters: z.object({
      sql: z.string().min(1),
    }),
    handler: async ({ sql }) => {
      const query = sql.trim()

      if (query.length === 0) {
        throw new Error("sql must not be empty")
      }

      const result = await args.services.pool.query(query)
      const rows = result.rows.slice(0, DATABASE_QUERY_MAX_ROWS).map(row => normalizeSqlRow(row))

      return {
        command: result.command,
        rowCount: result.rowCount,
        returnedRows: result.rows.length,
        rowsTruncated: result.rows.length > rows.length,
        rows,
      }
    },
  })
}

function normalizeSqlRow(row: unknown): unknown {
  if (!row || typeof row !== "object") {
    return row
  }

  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizeSqlValue(value)]),
  )
}

function normalizeSqlValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value
  }

  if (value.length <= DATABASE_QUERY_MAX_VALUE_LENGTH) {
    return value
  }

  return `${value.slice(0, DATABASE_QUERY_MAX_VALUE_LENGTH)}...<truncated>`
}
