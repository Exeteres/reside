import type { CommonServices } from "../services"
import { webcrypto } from "node:crypto"
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { CopilotClient, type CopilotSession, type SessionConfig } from "@github/copilot-sdk"
import { z } from "zod"
import { createStorageBucketService, type StorageBucketService } from "../database"
import { getReplicaName, subscribeToSecret } from "../kubernetes"
import { logger } from "../logger"
import {
  createLanguageMemorySystemPrompt,
  createMemoryTools,
  type MemoryToolTagDefinitions,
  type MemoryToolsPrisma,
} from "./memory"

const NLS_SESSION_ARCHIVE_EXTENSION = "tgz"
const NLS_NAMESPACE_PREFIX = "nls"
const NLS_SESSION_DIR = ".nls-session"
const NLS_SESSION_STATE_DIR = "session-state"
const NLS_WORKSPACE_PREFIX = "reside-nls"
const STORAGE_INIT_RETRY_MS = 1000
const STORAGE_INIT_MAX_ATTEMPTS = 5
const STORAGE_OPERATION_WAIT_TIMEOUT_MS = 30_000

const copilotSecretSchema = z.object({
  user_token: z.string().min(1),
})

export type LanguageEngineServices = Pick<
  CommonServices<"access" | "infra">,
  | "authzService"
  | "provisionService"
  | "infraOperationService"
  | "permissionRequestService"
  | "accessOperationService"
> & {
  prisma: MemoryToolsPrisma
}

export type LanguageEngine = {
  ask: (sessionId: string, text: string) => Promise<string>
  stop: () => Promise<void>
}

export type LanguageEngineStorageCredentials = {
  endpoint: string
  bucket: string
  accessKey: string
  secretKey: string
}

export type CreateLanguageEngineOptions = {
  services: LanguageEngineServices
  model: string
  sessionPrefix: string
  systemPrompt: string
  allowedSystemTools: string[]
  tools?: NonNullable<SessionConfig["tools"]>
  tags?: MemoryToolTagDefinitions
  storageCredentials?: LanguageEngineStorageCredentials
}

export async function createLanguageEngine(
  args: CreateLanguageEngineOptions,
): Promise<LanguageEngine> {
  ensureWebCryptoGlobals()

  const model = args.model.trim()
  if (model.length === 0) {
    throw new Error("createLanguageEngine model must not be empty")
  }

  const sessionPrefix = normalizeSessionPrefix(args.sessionPrefix)
  const baseSystemPrompt = args.systemPrompt.trim()
  const systemPrompt = [baseSystemPrompt, createLanguageMemorySystemPrompt(args.tags)].join("\n\n")
  if (systemPrompt.length === 0) {
    throw new Error("createLanguageEngine systemPrompt must not be empty")
  }

  const allowedSystemTools = new Set(
    args.allowedSystemTools.map(tool => tool.trim()).filter(Boolean),
  )
  const workspacePath = join("/tmp", `${NLS_WORKSPACE_PREFIX}-${getReplicaName()}`)
  await mkdir(workspacePath, { recursive: true })

  const storageBucketService =
    args.storageCredentials === undefined
      ? await waitForStorageBucketService(args.services)
      : createStorageBucketServiceFromCredentials(args.storageCredentials)

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

  const sessionLocks = new Map<string, Promise<void>>()

  const engineTools: NonNullable<SessionConfig["tools"]> = [
    ...createMemoryTools({
      prisma: args.services.prisma,
      tags: args.tags,
    }),
    ...(args.tools ?? []),
  ]
  const allowedCustomTools = collectCustomToolNames(engineTools)
  for (const toolName of allowedCustomTools) {
    allowedSystemTools.add(toolName)
  }

  return {
    ask: async (sessionId, text) => {
      const normalizedSessionId = normalizeSessionId(sessionId)
      const normalizedText = text.trim()
      if (normalizedText.length === 0) {
        throw new Error("text must not be empty")
      }

      return await runWithSessionLock(sessionLocks, normalizedSessionId, async () => {
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
            sessionPrefix,
            normalizedSessionId,
          ),
        }

        const sessionConfig: SessionConfig = {
          model,
          workingDirectory: workspacePath,
          configDir: sessionDirPath,
          systemMessage: {
            mode: "append",
            content: systemPrompt,
          },
          onPermissionRequest: async () => ({ kind: "approved" }),
          tools: engineTools,
          hooks: {
            onPreToolUse: async toolInvocation => {
              if (allowedSystemTools.has(toolInvocation.toolName)) {
                return {
                  permissionDecision: "allow" as const,
                }
              }

              return {
                permissionDecision: "deny" as const,
                permissionDecisionReason: `Tool "${toolInvocation.toolName}" is not allowed in language engine`,
              }
            },
          },
        }

        const session = await createOrResumeSession(copilotClient, environment, sessionConfig)

        try {
          const finalMessage = await session.sendAndWait({ prompt: normalizedText })
          const responseText = normalizeAgentResponse(finalMessage).trim()

          if (responseText.length === 0) {
            throw new Error("NLS returned empty response")
          }

          return responseText
        } finally {
          await session.disconnect()

          const currentSessionId = environment.sessionId?.trim()
          if (currentSessionId) {
            await uploadSessionArchive(
              storageBucketService,
              environment.sessionDirPath,
              sessionPrefix,
              normalizedSessionId,
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

function collectCustomToolNames(
  tools: NonNullable<SessionConfig["tools"]> | undefined,
): Set<string> {
  const names = new Set<string>()

  if (!tools) {
    return names
  }

  for (const tool of tools) {
    if (
      tool &&
      typeof tool === "object" &&
      "name" in tool &&
      typeof tool.name === "string" &&
      tool.name.length > 0
    ) {
      names.add(tool.name)
    }
  }

  return names
}

function normalizeSessionPrefix(sessionPrefix: string): string {
  const normalized = sessionPrefix.trim().replace(/^\/+|\/+$/g, "")
  if (normalized.length === 0) {
    throw new Error("sessionPrefix must not be empty")
  }

  return normalized
}

function normalizeSessionId(sessionId: string): string {
  const normalized = sessionId.trim()
  if (normalized.length === 0) {
    throw new Error("sessionId must not be empty")
  }

  return normalized
}

async function waitForStorageBucketService(
  services: LanguageEngineServices,
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
  credentials: LanguageEngineStorageCredentials,
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
  sessionPrefix: string,
  sessionStorageId: string,
): Promise<string | undefined> {
  const archiveKey = getSessionArchiveKey(sessionPrefix, sessionStorageId)
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
  sessionPrefix: string,
  sessionStorageId: string,
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
    `session-upload-${sanitizeFilePart(sessionStorageId)}.${NLS_SESSION_ARCHIVE_EXTENSION}`,
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
      Key: getSessionArchiveKey(sessionPrefix, sessionStorageId),
      Body: bytes,
      ContentType: "application/x-tar",
    }),
  )

  await rm(archivePath, { force: true })
}

function getSessionArchiveKey(sessionPrefix: string, sessionId: string): string {
  return `${NLS_NAMESPACE_PREFIX}/${sessionPrefix}/${sessionId}.${NLS_SESSION_ARCHIVE_EXTENSION}`
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

async function runWithSessionLock<T>(
  sessionLocks: Map<string, Promise<void>>,
  sessionStorageId: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = sessionLocks.get(sessionStorageId) ?? Promise.resolve()
  let release: (() => void) | undefined

  const current = new Promise<void>(resolve => {
    release = resolve
  })
  sessionLocks.set(
    sessionStorageId,
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
