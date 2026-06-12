import type { Pool } from "pg"
import type { CommonServices } from "../services"
import { webcrypto } from "node:crypto"
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { CopilotClient, type CopilotSession, type SessionConfig } from "@github/copilot-sdk"
import { z } from "zod"
import { createStorageBucketService, type StorageBucketService } from "../database"
import { crypto } from "../encryption"
import { getReplicaName } from "../kubernetes"
import { logger } from "../logger"
import {
  createLanguageMemorySystemPrompt,
  createMemoryTools,
  type MemoryToolsPrisma,
  type MemoryToolTagDefinitions,
} from "./memory"

const NLS_SESSION_ARCHIVE_EXTENSION = "tgz"
const NLS_NAMESPACE_PREFIX = "nls"
const NLS_SESSION_DIR = ".nls-session"
const NLS_SESSION_STATE_DIR = "session-state"
const NLS_WORKSPACE_PREFIX = "reside-nls"
const STORAGE_INIT_RETRY_MS = 1000
const STORAGE_INIT_MAX_ATTEMPTS = 5
const STORAGE_OPERATION_WAIT_TIMEOUT_MS = 30_000
const LLM_SECRET_NAME = "llm"

export type LanguageEngineModelTier = "light" | "smart"

export type LanguageEngineServices = Pick<
  CommonServices<"access" | "infra">,
  | "authzService"
  | "provisionService"
  | "infraOperationService"
  | "permissionRequestService"
  | "accessOperationService"
> & {
  pool: Pool
  prisma: MemoryToolsPrisma
}

export type LanguageEngine = {
  ask: (sessionId: string, text: string, options?: LanguageEngineAskOptions) => Promise<string>
  askStream: (
    sessionId: string,
    text: string,
    onFrame: (frame: { text: string; reset: boolean }) => Promise<void>,
    options?: LanguageEngineAskOptions,
  ) => Promise<string>
  clearContext: (sessionId: string) => Promise<void>
  stop: () => Promise<void>
}

export type LanguageEngineAskOptions = {
  systemPrompt?: string
  workingDirectory?: string
  configDir?: string
  tools?: NonNullable<SessionConfig["tools"]>
  allowedSystemTools?: string[]
  shouldCancel?: () => Promise<boolean>
  cancelPollIntervalMs?: number
}

export type LanguageEngineStorageCredentials = {
  endpoint: string
  bucket: string
  accessKey: string
  secretKey: string
}

export type CreateLanguageEngineOptions = {
  services: LanguageEngineServices
  model: LanguageEngineModelTier
  sessionPrefix: string
  systemPrompt: string
  allowedSystemTools: string[]
  tools?: NonNullable<SessionConfig["tools"]>
  tags?: MemoryToolTagDefinitions
  storageCredentials?: LanguageEngineStorageCredentials
  copilotClientProvider?: () => CopilotClient
}

const llmSecretSchema = z.object({
  endpoint: z.string().trim().min(1),
  "api-key": z.string().trim().min(1),
  "light-model": z.string().trim().min(1),
  "smart-model": z.string().trim().min(1),
})

export async function createLanguageEngine(
  args: CreateLanguageEngineOptions,
): Promise<LanguageEngine> {
  ensureWebCryptoGlobals()

  const llmSecret = await crypto.getSecret(llmSecretSchema, LLM_SECRET_NAME)
  const model = selectLlmModel(llmSecret, args.model)
  const provider: NonNullable<SessionConfig["provider"]> = {
    type: "openai",
    baseUrl: llmSecret.endpoint,
    apiKey: llmSecret["api-key"],
  }

  const sessionPrefix = normalizeSessionPrefix(args.sessionPrefix)
  const copilotClientProvider = args.copilotClientProvider
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
  if (!args.copilotClientProvider) {
    const nextClient = new CopilotClient({
      useLoggedInUser: false,
    })
    await nextClient.start()
    currentCopilotClient = nextClient
    logger.info("nls language client initialized")
  }

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
    ask: async (sessionId, text, options) => {
      return await runLanguageEngineSession({
        sessionId,
        text,
        systemPrompt: options?.systemPrompt,
        workingDirectory: options?.workingDirectory,
        configDir: options?.configDir,
        tools: options?.tools,
        allowedSystemTools: options?.allowedSystemTools,
        shouldCancel: options?.shouldCancel,
        cancelPollIntervalMs: options?.cancelPollIntervalMs,
      })
    },
    askStream: async (sessionId, text, onFrame, options) => {
      return await runLanguageEngineSession({
        sessionId,
        text,
        onFrame,
        systemPrompt: options?.systemPrompt,
        workingDirectory: options?.workingDirectory,
        configDir: options?.configDir,
        tools: options?.tools,
        allowedSystemTools: options?.allowedSystemTools,
        shouldCancel: options?.shouldCancel,
        cancelPollIntervalMs: options?.cancelPollIntervalMs,
      })
    },
    clearContext: async sessionId => {
      const normalizedSessionId = normalizeSessionId(sessionId)

      await runWithSessionLock(sessionLocks, normalizedSessionId, async () => {
        const sessionDirPath = join(workspacePath, NLS_SESSION_DIR)
        await mkdir(sessionDirPath, { recursive: true })
        await clearSessionArchive(
          storageBucketService,
          sessionDirPath,
          sessionPrefix,
          normalizedSessionId,
        )
      })
    },
    stop: async () => {
      if (currentCopilotClient) {
        await currentCopilotClient.stop()
      }
    },
  }

  async function runLanguageEngineSession(args: {
    sessionId: string
    text: string
    systemPrompt?: string
    workingDirectory?: string
    configDir?: string
    tools?: NonNullable<SessionConfig["tools"]>
    allowedSystemTools?: string[]
    shouldCancel?: () => Promise<boolean>
    cancelPollIntervalMs?: number
    onFrame?: (frame: { text: string; reset: boolean }) => Promise<void>
  }): Promise<string> {
    const normalizedSessionId = normalizeSessionId(args.sessionId)
    const normalizedText = args.text.trim()
    if (normalizedText.length === 0) {
      throw new Error("text must not be empty")
    }

    return await runWithSessionLock(sessionLocks, normalizedSessionId, async () => {
      const copilotClient = copilotClientProvider?.() ?? currentCopilotClient
      if (!copilotClient) {
        throw new Error("Copilot client is not initialized")
      }

      const sessionWorkingDirectory = args.workingDirectory ?? workspacePath
      const sessionDirPath = args.configDir ?? join(workspacePath, NLS_SESSION_DIR)
      await mkdir(sessionDirPath, { recursive: true })

      const sessionTools = [...engineTools, ...(args.tools ?? [])]
      const sessionAllowedSystemTools = new Set(allowedSystemTools)
      for (const toolName of args.allowedSystemTools ?? []) {
        const normalizedToolName = toolName.trim()
        if (normalizedToolName.length > 0) {
          sessionAllowedSystemTools.add(normalizedToolName)
        }
      }
      for (const toolName of collectCustomToolNames(args.tools)) {
        sessionAllowedSystemTools.add(toolName)
      }

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
        provider,
        streaming: true,
        workingDirectory: sessionWorkingDirectory,
        configDir: sessionDirPath,
        systemMessage: {
          mode: "append",
          content: [systemPrompt, args.systemPrompt?.trim()].filter(Boolean).join("\n\n"),
        },
        onPermissionRequest: async () => ({ kind: "approved" }),
        tools: sessionTools,
        hooks: {
          onPreToolUse: async toolInvocation => {
            if (sessionAllowedSystemTools.has(toolInvocation.toolName)) {
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
      const unsubscribeRealtimeLogs = registerLanguageSessionLogs(session, normalizedSessionId)
      const stopCancellationWatcher = watchLanguageSessionCancellation({
        session,
        shouldCancel: args.shouldCancel,
        pollIntervalMs: args.cancelPollIntervalMs,
      })
      let unsubscribeAssistantMessage: (() => void) | undefined
      let unsubscribeAssistantMessageDelta: (() => void) | undefined
      let frameChain = Promise.resolve()
      let hasStreamedFrame = false
      let lastStreamedText = ""
      let currentStreamMessageId: string | undefined
      const streamedTextByMessageId = new Map<string, string>()
      const deltaSeenMessageIds = new Set<string>()

      const queueFrame = (frame: { text: string; reset: boolean }) => {
        frameChain = frameChain
          .then(async () => {
            hasStreamedFrame = true
            lastStreamedText = frame.text
            await args.onFrame?.(frame)
          })
          .catch(error => {
            logger.warn({ error: normalizeError(error) }, "nls stream frame callback failed")
          })
      }

      if (args.onFrame) {
        unsubscribeAssistantMessageDelta = session.on("assistant.message_delta", event => {
          const deltaContent = event.data.deltaContent
          if (deltaContent.length === 0) {
            return
          }

          const messageId = event.data.messageId
          const previousText = streamedTextByMessageId.get(messageId) ?? ""
          const nextText = `${previousText}${deltaContent}`
          const reset = currentStreamMessageId !== messageId

          streamedTextByMessageId.set(messageId, nextText)
          deltaSeenMessageIds.add(messageId)
          currentStreamMessageId = messageId

          queueFrame({
            text: nextText,
            reset,
          })
        })

        unsubscribeAssistantMessage = session.on("assistant.message", event => {
          const frameText = normalizeAgentResponse(event.data.content).trim()
          if (frameText.length === 0) {
            return
          }

          const messageId = event.data.messageId
          const hasDeltaFrames = deltaSeenMessageIds.has(messageId)
          const accumulatedText = streamedTextByMessageId.get(messageId) ?? ""

          if (!hasDeltaFrames) {
            const reset = currentStreamMessageId !== messageId
            currentStreamMessageId = messageId

            queueFrame({
              text: frameText,
              reset,
            })
            return
          }

          if (accumulatedText !== frameText) {
            streamedTextByMessageId.set(messageId, frameText)
            queueFrame({
              text: frameText,
              reset: false,
            })
          }
        })
      }

      let sessionError: unknown

      try {
        logger.info(
          'nls session prompt session_id="%s" prompt="%s"',
          normalizedSessionId,
          truncateOneLine(normalizedText, 1000),
        )

        const finalMessage = await session.sendAndWait({ prompt: normalizedText })
        const responseText = normalizeAgentResponse(finalMessage).trim()

        if (responseText.length === 0) {
          throw new Error("NLS returned empty response")
        }

        if (args.onFrame) {
          await frameChain

          if (!hasStreamedFrame || lastStreamedText !== responseText) {
            await args.onFrame({
              text: responseText,
              reset: !hasStreamedFrame,
            })
          }
        }

        return responseText
      } catch (error) {
        sessionError = error
        const errorObject = normalizeError(error)

        logger.error(
          { error: errorObject },
          'nls session failed session_id="%s"',
          normalizedSessionId,
        )

        throw new Error(`NLS session "${normalizedSessionId}" failed`, {
          cause: errorObject,
        })
      } finally {
        stopCancellationWatcher()
        unsubscribeRealtimeLogs()
        unsubscribeAssistantMessageDelta?.()
        unsubscribeAssistantMessage?.()

        try {
          await session.disconnect()
        } catch (error) {
          logger.warn(
            { error: normalizeError(error) },
            'nls session disconnect failed session_id="%s"',
            normalizedSessionId,
          )
        }

        const currentSessionId = environment.sessionId?.trim()
        if (currentSessionId) {
          try {
            await uploadSessionArchive(
              storageBucketService,
              environment.sessionDirPath,
              sessionPrefix,
              normalizedSessionId,
              currentSessionId,
            )
          } catch (error) {
            logger.warn(
              { error: normalizeError(error) },
              'nls session archive upload failed session_id="%s" copilot_session_id="%s" after_error="%s"',
              normalizedSessionId,
              currentSessionId,
              sessionError === undefined ? "false" : "true",
            )
          }
        }
      }
    })
  }
}

function registerLanguageSessionLogs(session: CopilotSession, sessionId: string): () => void {
  const unsubscribers = [
    session.on("assistant.message", event => {
      const content = event.data.content.trim()
      if (content.length === 0) {
        return
      }

      logger.info(
        'nls assistant message session_id="%s" message_id="%s" content="%s"',
        sessionId,
        event.data.messageId,
        truncateOneLine(content, 2000),
      )
    }),
    session.on("tool.execution_start", event => {
      const argumentSummary = summarizeToolArguments(event.data.toolName, event.data.arguments)

      logger.info(
        'nls tool execution started session_id="%s" tool_name="%s" tool_call_id="%s" args="%s"',
        sessionId,
        event.data.toolName,
        event.data.toolCallId,
        argumentSummary,
      )
    }),
  ]

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe()
    }
  }
}

function watchLanguageSessionCancellation({
  session,
  shouldCancel,
  pollIntervalMs,
}: {
  session: CopilotSession
  shouldCancel?: () => Promise<boolean>
  pollIntervalMs?: number
}): () => void {
  if (!shouldCancel) {
    return () => undefined
  }

  let stopped = false
  const intervalMs = Math.max(250, pollIntervalMs ?? 1000)

  const loop = async () => {
    while (!stopped) {
      await Bun.sleep(intervalMs)
      if (stopped) {
        return
      }

      try {
        if (await shouldCancel()) {
          await session.disconnect()
          return
        }
      } catch (error) {
        logger.warn({ error: normalizeError(error) }, "nls cancellation check failed")
      }
    }
  }

  void loop().catch(error => {
    logger.warn({ error: normalizeError(error) }, "nls cancellation watcher failed")
  })

  return () => {
    stopped = true
  }
}

function summarizeToolArguments(toolName: string, argumentsValue: unknown): string {
  if (!argumentsValue || typeof argumentsValue !== "object") {
    return "{}"
  }

  const typedArguments = argumentsValue as Record<string, unknown>

  if (toolName === "apply_patch") {
    const patchInput = typeof typedArguments.input === "string" ? typedArguments.input : ""
    const files = extractApplyPatchFilePaths(patchInput)
    const listedFiles = files
      .slice(0, 5)
      .map(path => truncateOneLine(path, 120))
      .join(",")
    const filesPart =
      files.length > 0
        ? `files=${listedFiles}${files.length > 5 ? ` (+${files.length - 5} more)` : ""}`
        : "files=<unknown>"
    const explanation =
      typeof typedArguments.explanation === "string"
        ? truncateOneLine(typedArguments.explanation, 160)
        : ""

    return explanation.length > 0 ? `${filesPart} explanation=${explanation}` : filesPart
  }

  if (toolName === "bash") {
    const command = typeof typedArguments.command === "string" ? typedArguments.command : ""
    return `command=${truncateOneLine(command, 1000)}`
  }

  if (toolName === "query_database") {
    const sql = typeof typedArguments.sql === "string" ? typedArguments.sql : ""
    return `sql_length=${sql.length}`
  }

  const pathKeys = [
    "filePath",
    "path",
    "dirPath",
    "workspaceRoot",
    "workingDirectory",
    "includePattern",
    "query",
  ]

  const pathParts = pathKeys
    .map(key => {
      const value = typedArguments[key]
      if (typeof value !== "string" || value.length === 0) {
        return undefined
      }

      return `${key}=${truncateOneLine(value, 180)}`
    })
    .filter((value): value is string => Boolean(value))

  if (pathParts.length > 0) {
    return pathParts.join(" ")
  }

  const summary = Object.entries(typedArguments)
    .filter(([key]) => !["content", "newCode", "codeSnippet", "prompt"].includes(key))
    .map(([key, value]) => {
      if (typeof value === "string") {
        return `${key}=${truncateOneLine(value, 120)}`
      }

      if (typeof value === "number" || typeof value === "boolean") {
        return `${key}=${String(value)}`
      }

      if (Array.isArray(value)) {
        return `${key}=[${value.length}]`
      }

      if (value && typeof value === "object") {
        return `${key}={...}`
      }

      return `${key}=null`
    })
    .join(" ")

  return summary.length > 0 ? summary : "{}"
}

function extractApplyPatchFilePaths(patchInput: string): string[] {
  if (patchInput.trim().length === 0) {
    return []
  }

  const matches = [...patchInput.matchAll(/^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+)$/gm)]
  const paths = matches
    .map(match => match[1]?.trim() ?? "")
    .map(path => path.replace(/\s+->.+$/, "").trim())
    .filter(path => path.length > 0)

  return [...new Set(paths)]
}

function truncateOneLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength)}...`
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

function selectLlmModel(
  secret: z.infer<typeof llmSecretSchema>,
  tier: LanguageEngineModelTier,
): string {
  if (tier === "light") {
    return secret["light-model"]
  }

  return secret["smart-model"]
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
        { error: normalizeError(error) },
        'nls failed to resume session previous_session_id="%s"',
        previousSessionId,
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

async function clearSessionArchive(
  storageBucketService: StorageBucketService,
  sessionDirPath: string,
  sessionPrefix: string,
  sessionStorageId: string,
): Promise<void> {
  const archiveKey = getSessionArchiveKey(sessionPrefix, sessionStorageId)
  const archivePath = join(
    "/tmp",
    `${NLS_WORKSPACE_PREFIX}-${getReplicaName()}`,
    `session-clear-${sanitizeFilePart(sessionStorageId)}.${NLS_SESSION_ARCHIVE_EXTENSION}`,
  )

  try {
    const object = await storageBucketService.client.send(
      new GetObjectCommand({
        Bucket: storageBucketService.bucket,
        Key: archiveKey,
      }),
    )

    if (object.Body) {
      const bytes = await object.Body.transformToByteArray()
      await writeFile(archivePath, Buffer.from(bytes))

      const sessionId = await readSessionIdFromArchive(archivePath)
      if (sessionId) {
        await rm(getSessionStatePath(sessionDirPath, sessionId), { recursive: true, force: true })
      }
    }
  } catch {
    // absence of an archive is already a cleared persisted context
  } finally {
    await rm(archivePath, { force: true })
  }

  await storageBucketService.client.send(
    new DeleteObjectCommand({
      Bucket: storageBucketService.bucket,
      Key: archiveKey,
    }),
  )
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
