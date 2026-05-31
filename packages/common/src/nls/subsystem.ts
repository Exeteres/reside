import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { webcrypto } from "node:crypto"
import { join } from "node:path"
import type { FastifyInstance } from "fastify"
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { create } from "@bufbuild/protobuf"
import type { ConnectRouter } from "@connectrpc/connect"
import { Code, ConnectError, type HandlerContext } from "@connectrpc/connect"
import { S3Client } from "@aws-sdk/client-s3"
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { waitForOperationSuccess } from "@reside/api"
import {
  CopilotClient,
  defineTool,
  type CopilotSession,
  type SessionConfig,
} from "@github/copilot-sdk"
import { DiscoveryService, type DiscoveryServiceClient } from "@reside/api/alpha/discovery.v1"
import { ReplicaService, type ReplicaServiceClient } from "@reside/api/alpha/replica.v1"
import {
  AskResponseSchema,
  NaturalLanguageService,
  type NaturalLanguageServiceClient,
  type NaturalLanguageServiceImplementation,
} from "@reside/api/interaction/nls.v1"
import { WellKnownPermissions, alphaReplica } from "@reside/registry"
import { z } from "zod"
import { createChannel, createClient } from "../api"
import { authenticate } from "../auth"
import { createStorageBucketService, type StorageBucketService } from "../database"
import { getReplicaName, subscribeToSecret } from "../kubernetes"
import { logger } from "../logger"
import type { CommonServices } from "../services"
import { registerGracefulShutdown } from "../utils"

const NLS_MODEL = "gpt-5-mini"
const NLS_SESSION_ARCHIVE_EXTENSION = "tgz"
const NLS_SESSION_ARCHIVE_PREFIX = "nls/sessions"
const NLS_SESSION_DIR = ".nls-session"
const NLS_SESSION_STATE_DIR = "session-state"
const NLS_WORKSPACE_PREFIX = "reside-nls"
const STORAGE_INIT_RETRY_MS = 1000
const STORAGE_INIT_MAX_ATTEMPTS = 5
const STORAGE_OPERATION_WAIT_TIMEOUT_MS = 30_000

const copilotSecretSchema = z.object({
  user_token: z.string().min(1),
})

type LanguageSubsystemServices = Pick<
  CommonServices<"access" | "infra">,
  | "authzService"
  | "provisionService"
  | "infraOperationService"
  | "permissionRequestService"
  | "accessOperationService"
>

type LanguageRuntime = {
  ask: (peerSubjectId: string, prompt: string) => Promise<string>
  stop: () => Promise<void>
}

export type LanguageSubsystemStorageCredentials = {
  endpoint: string
  bucket: string
  accessKey: string
  secretKey: string
}

export type SetupLanguageSubsystemOptions = {
  services: LanguageSubsystemServices
  server: FastifyInstance
  title: string
  description: string
  mission: string
  storageCredentials?: LanguageSubsystemStorageCredentials
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
  let runtime: LanguageRuntime

  try {
    runtime = await startLanguageRuntime({
      services,
      title,
      description,
      mission,
      storageCredentials,
      tools,
    })
  } catch (error) {
    logger.warn(
      { error: normalizeError(error) },
      "nls initialization skipped because dependencies are unavailable",
    )

    return
  }

  registerGracefulShutdown(async () => {
    await runtime.stop()
  })

  await server.register(fastifyConnectPlugin, {
    routes(router: ConnectRouter) {
      router.service(NaturalLanguageService, createNaturalLanguageService(services, runtime))
    },
  })
}

function createNaturalLanguageService(
  services: LanguageSubsystemServices,
  runtime: LanguageRuntime,
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

      const text = await runtime.ask(effectiveFromSubjectId, prompt)
      return create(AskResponseSchema, { text })
    },
  }
}

async function startLanguageRuntime(args: {
  services: LanguageSubsystemServices
  title: string
  description: string
  mission: string
  storageCredentials?: LanguageSubsystemStorageCredentials
  tools?: NonNullable<SessionConfig["tools"]>
}): Promise<LanguageRuntime> {
  ensureWebCryptoGlobals()

  const mission = args.mission.trim()
  if (mission.length === 0) {
    throw new Error("setupLanguageSubsystem mission must not be empty")
  }

  const systemPrompt = buildReplicaSystemPrompt({
    replicaName: getReplicaName(),
    title: args.title,
    description: args.description,
    mission,
  })

  const workspacePath = join("/tmp", `${NLS_WORKSPACE_PREFIX}-${getReplicaName()}`)
  await mkdir(workspacePath, { recursive: true })

  const storageBucketService =
    args.storageCredentials === undefined
      ? await waitForStorageBucketService(args.services)
      : createStorageBucketServiceFromCredentials(args.storageCredentials)
  const alphaChannel = createChannel(alphaReplica.endpoint)
  const alphaDiscoveryService = createClient(DiscoveryService, alphaChannel)
  const alphaReplicaService = createClient(ReplicaService, alphaChannel)
  let currentCopilotClient: CopilotClient | undefined
  let lastCopilotError: string | undefined
  let resolveReady: (() => void) | undefined
  const readyPromise = new Promise<void>(resolve => {
    resolveReady = resolve
  })

  const stopCopilotSubscription = startSubscription(subscribeToSecret("copilot"), async secret => {
    try {
      const parsed = copilotSecretSchema.parse(secret)

      if (currentCopilotClient) {
        await currentCopilotClient.stop()
      }

      const nextClient = new CopilotClient({
        githubToken: parsed.user_token,
        useLoggedInUser: false,
      })
      await nextClient.start()
      currentCopilotClient = nextClient
      lastCopilotError = undefined

      if (resolveReady) {
        resolveReady()
        resolveReady = undefined
      }

      logger.info("nls copilot client initialized")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      lastCopilotError = message

      logger.warn({ error: message }, "nls failed to initialize copilot client")
    }
  })

  await readyPromise

  const peerLocks = new Map<string, Promise<void>>()

  return {
    ask: async (peerSubjectId, prompt) => {
      return await runWithPeerLock(peerLocks, peerSubjectId, async () => {
        const copilotClient = currentCopilotClient
        if (!copilotClient) {
          const reason = lastCopilotError ? ` Last error: ${lastCopilotError}` : ""
          throw new Error(`Copilot client is not initialized.${reason}`)
        }

        const sessionDirPath = join(workspacePath, NLS_SESSION_DIR)
        await mkdir(sessionDirPath, { recursive: true })

        const environment: {
          sessionId: string | undefined
          sessionDirPath: string
        } = {
          sessionDirPath,
          sessionId: await restoreSessionArchive(
            storageBucketService,
            sessionDirPath,
            peerSubjectId,
          ),
        }

        const sessionConfig: SessionConfig = {
          model: NLS_MODEL,
          workingDirectory: workspacePath,
          configDir: sessionDirPath,
          systemMessage: {
            mode: "append",
            content: systemPrompt,
          },
          onPermissionRequest: async () => ({ kind: "approved" }),
          tools: [
            createAskReplicaTool({
              services: args.services,
              alphaDiscoveryService,
              peerSubjectId,
            }),
            createListReplicasTool({
              alphaReplicaService,
            }),
            ...(args.tools ?? []),
          ],
        }

        const session = await createOrResumeSession(copilotClient, environment, sessionConfig)

        try {
          const finalMessage = await session.sendAndWait({ prompt })
          const text = normalizeAgentResponse(finalMessage).trim()

          if (text.length === 0) {
            throw new Error("NLS returned empty response")
          }

          return text
        } finally {
          await session.disconnect()

          const currentSessionId = environment.sessionId?.trim()
          if (currentSessionId) {
            await uploadSessionArchive(
              storageBucketService,
              environment.sessionDirPath,
              peerSubjectId,
              currentSessionId,
            )
          }
        }
      })
    },
    stop: async () => {
      await stopCopilotSubscription()

      if (currentCopilotClient) {
        await currentCopilotClient.stop()
      }
    },
  }
}

async function waitForStorageBucketService(
  services: LanguageSubsystemServices,
): Promise<StorageBucketService> {
  for (let attempt = 1; attempt <= STORAGE_INIT_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await createStorageBucketService(services, {
        operationWaitTimeoutMs: STORAGE_OPERATION_WAIT_TIMEOUT_MS,
      })
    } catch (error) {
      logger.warn(
        { error: normalizeError(error) },
        'nls failed to initialize storage bucket service attempt="%d" max_attempts="%d" retrying',
        attempt,
        STORAGE_INIT_MAX_ATTEMPTS,
      )

      if (attempt === STORAGE_INIT_MAX_ATTEMPTS) {
        throw new Error(
          `NLS storage bucket service is unavailable after ${STORAGE_INIT_MAX_ATTEMPTS} attempts`,
          { cause: error },
        )
      }

      await Bun.sleep(STORAGE_INIT_RETRY_MS)
    }
  }

  throw new Error("NLS storage bucket service initialization loop exited unexpectedly")
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}

function createStorageBucketServiceFromCredentials(
  credentials: LanguageSubsystemStorageCredentials,
): StorageBucketService {
  return {
    client: new S3Client({
      endpoint: `http://${credentials.endpoint}`,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: credentials.accessKey,
        secretAccessKey: credentials.secretKey,
      },
    }),
    bucket: credentials.bucket,
  }
}

async function createOrResumeSession(
  copilotClient: CopilotClient,
  environment: { sessionId: string | undefined; sessionDirPath: string },
  sessionConfig: SessionConfig,
): Promise<CopilotSession> {
  const previousSessionId = environment.sessionId?.trim()

  if (previousSessionId) {
    try {
      const resumedSession = await copilotClient.resumeSession(previousSessionId, sessionConfig)
      environment.sessionId = resumedSession.sessionId

      return resumedSession
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error), previousSessionId },
        "nls failed to resume session, creating a new one",
      )
    }
  }

  const nextSession = await copilotClient.createSession(sessionConfig)
  environment.sessionId = nextSession.sessionId

  return nextSession
}

async function restoreSessionArchive(
  storageBucketService: StorageBucketService,
  sessionDirPath: string,
  peerSubjectId: string,
): Promise<string | undefined> {
  const archiveKey = getSessionArchiveKey(peerSubjectId)
  const archivePath = join(sessionDirPath, `session.${NLS_SESSION_ARCHIVE_EXTENSION}`)

  try {
    const object = await storageBucketService.client.send(
      new GetObjectCommand({
        Bucket: storageBucketService.bucket,
        Key: archiveKey,
      }),
    )

    if (!object.Body) {
      return undefined
    }

    const bytes = await object.Body.transformToByteArray()
    await writeFile(archivePath, Buffer.from(bytes))

    const sessionId = await readSessionIdFromArchive(archivePath)
    if (!sessionId) {
      await rm(archivePath, { force: true })
      return undefined
    }

    const restoredSessionPath = getSessionStatePath(sessionDirPath, sessionId)
    await rm(restoredSessionPath, { recursive: true, force: true })
    await mkdir(restoredSessionPath, { recursive: true })
    await runCommand([
      "tar",
      "-xzf",
      archivePath,
      "-C",
      restoredSessionPath,
      "--strip-components=1",
    ])
    await rm(archivePath, { force: true })

    return sessionId
  } catch {
    return undefined
  }
}

async function uploadSessionArchive(
  storageBucketService: StorageBucketService,
  sessionDirPath: string,
  peerSubjectId: string,
  sessionId: string,
): Promise<void> {
  const sessionStatePath = getSessionStatePath(sessionDirPath, sessionId)

  try {
    await access(sessionStatePath)
  } catch {
    return
  }

  const archivePath = join(
    "/tmp",
    `${NLS_WORKSPACE_PREFIX}-${getReplicaName()}`,
    `session-upload-${sanitizeFilePart(peerSubjectId)}.${NLS_SESSION_ARCHIVE_EXTENSION}`,
  )

  await runCommand([
    "tar",
    "-czf",
    archivePath,
    "-C",
    sessionStatePath,
    "--transform",
    `s,^,${sessionId}/,`,
    ".",
  ])

  const bytes = await readFile(archivePath)
  await storageBucketService.client.send(
    new PutObjectCommand({
      Bucket: storageBucketService.bucket,
      Key: getSessionArchiveKey(peerSubjectId),
      Body: bytes,
      ContentType: "application/x-tar",
    }),
  )

  await rm(archivePath, { force: true })
}

function getSessionArchiveKey(peerSubjectId: string): string {
  return `${NLS_SESSION_ARCHIVE_PREFIX}/${peerSubjectId}.${NLS_SESSION_ARCHIVE_EXTENSION}`
}

function getSessionStatePath(sessionDirPath: string, sessionId: string): string {
  return join(sessionDirPath, NLS_SESSION_STATE_DIR, sessionId)
}

async function readSessionIdFromArchive(archivePath: string): Promise<string | undefined> {
  const { stdout } = await runCommandWithOutput(["tar", "-tzf", archivePath])
  const topLevelEntries = stdout
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.split("/")[0])
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)

  const uniqueEntries = [...new Set(topLevelEntries)]
  if (uniqueEntries.length !== 1) {
    return undefined
  }

  const [candidate] = uniqueEntries
  if (
    !candidate ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
  ) {
    return undefined
  }

  return candidate
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
  services: LanguageSubsystemServices
  alphaDiscoveryService: DiscoveryServiceClient
  peerSubjectId: string
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
            peerSubjectId: args.peerSubjectId,
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

function normalizeAgentResponse(response: unknown): string {
  if (typeof response === "string") {
    return response
  }

  if (response && typeof response === "object") {
    const objectResponse = response as {
      text?: unknown
      content?: unknown
      message?: unknown
      data?: {
        content?: unknown
      }
    }

    const values = [
      objectResponse.text,
      objectResponse.content,
      objectResponse.message,
      objectResponse.data?.content,
    ]

    for (const value of values) {
      if (typeof value === "string") {
        return value
      }
    }

    try {
      return JSON.stringify(response)
    } catch {
      return String(response)
    }
  }

  return String(response)
}

function ensureWebCryptoGlobals(): void {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto as unknown as Crypto
  }
}

function startSubscription<T>(
  iterable: AsyncIterable<T>,
  onValue: (value: T) => Promise<void>,
): () => Promise<void> {
  const iterator = iterable[Symbol.asyncIterator]()
  let isStopped = false

  const loop = (async () => {
    while (!isStopped) {
      const next = await iterator.next()
      if (next.done || isStopped) {
        break
      }

      await onValue(next.value)
    }
  })().catch(error => {
    logger.error({ error }, "nls subscription loop failed")
  })

  return async () => {
    isStopped = true

    try {
      void iterator.return?.()
    } catch {
      // no-op
    }

    await loop
  }
}

async function runWithPeerLock<T>(
  peerLocks: Map<string, Promise<void>>,
  peerSubjectId: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = peerLocks.get(peerSubjectId) ?? Promise.resolve()
  let release: (() => void) | undefined

  const current = new Promise<void>(resolve => {
    release = resolve
  })
  peerLocks.set(
    peerSubjectId,
    previous.then(async () => await current),
  )

  await previous

  try {
    return await action()
  } finally {
    release?.()
  }
}

async function runCommand(command: string[]): Promise<void> {
  const process = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
  })

  const exitCode = await process.exited
  if (exitCode === 0) {
    return
  }

  const stderr = await process.stderr.text()
  throw new Error(`Command failed: ${command.join(" ")} (${stderr.trim()})`)
}

async function runCommandWithOutput(command: string[]): Promise<{ stdout: string }> {
  const process = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
  })

  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    process.stdout.text(),
    process.stderr.text(),
  ])

  if (exitCode !== 0) {
    throw new Error(`Command failed: ${command.join(" ")} (${stderr.trim()})`)
  }

  return { stdout }
}

function sanitizeFilePart(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, "_")
}
