import type { ThreadEvent, ThreadItem } from "@openai/codex-sdk"
import type { Pool } from "pg"
import type { CommonServices } from "../services"
import type { Tool } from "./tool"
import { randomUUID, webcrypto } from "node:crypto"
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { Codex } from "@openai/codex-sdk"
import { z } from "zod"
import { createStorageBucketService, type StorageBucketService } from "../database"
import { crypto } from "../encryption"
import { getReplicaName } from "../kubernetes"
import { logger } from "../logger"
import { type NlsMcpToolServer, startNlsMcpToolServer } from "./mcp-tool-server"
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
const DEFAULT_LANGUAGE_ENGINE_IDLE_TIMEOUT_MS = 120_000
const LLM_SECRET_NAME = "llm"
const MCP_TOKEN_ENV_VAR = "RESIDE_NLS_MCP_TOKEN"
const CODEX_MODEL_PROVIDER_ID = "reside"

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
  tools?: Tool[]
  idleTimeoutMs?: number
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
  tools?: Tool[]
  tags?: MemoryToolTagDefinitions
  storageCredentials?: LanguageEngineStorageCredentials
}

type CodexConfigValue = string | number | boolean | CodexConfigValue[] | CodexConfigObject

type CodexConfigObject = {
  [key: string]: CodexConfigValue
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
  const sessionPrefix = normalizeSessionPrefix(args.sessionPrefix)
  const baseSystemPrompt = args.systemPrompt.trim()
  const systemPrompt = [baseSystemPrompt, createLanguageMemorySystemPrompt(args.tags)].join("\n\n")
  if (systemPrompt.length === 0) {
    throw new Error("createLanguageEngine systemPrompt must not be empty")
  }

  const workspacePath = join("/tmp", `${NLS_WORKSPACE_PREFIX}-${getReplicaName()}`)
  await mkdir(workspacePath, { recursive: true })

  const storageBucketService =
    args.storageCredentials === undefined
      ? await waitForStorageBucketService(args.services)
      : createStorageBucketServiceFromCredentials(args.storageCredentials)

  const engineTools: Tool[] = [
    ...createMemoryTools({
      prisma: args.services.prisma,
      tags: args.tags,
    }),
    ...(args.tools ?? []),
  ]

  const sessionLocks = new Map<string, Promise<void>>()
  logger.info("nls language client initialized")

  return {
    ask: async (sessionId, text, options) => {
      return await runLanguageEngineSession({
        sessionId,
        text,
        systemPrompt: options?.systemPrompt,
        workingDirectory: options?.workingDirectory,
        configDir: options?.configDir,
        tools: options?.tools,
        idleTimeoutMs: options?.idleTimeoutMs,
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
        idleTimeoutMs: options?.idleTimeoutMs,
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
    stop: async () => undefined,
  }

  async function runLanguageEngineSession(args: {
    sessionId: string
    text: string
    systemPrompt?: string
    workingDirectory?: string
    configDir?: string
    tools?: Tool[]
    idleTimeoutMs?: number
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
      const sessionWorkingDirectory = args.workingDirectory ?? workspacePath
      const sessionDirPath = args.configDir ?? join(workspacePath, NLS_SESSION_DIR)
      await mkdir(sessionDirPath, { recursive: true })

      const sessionTools = [...engineTools, ...(args.tools ?? [])]
      const restoredThreadId = await restoreSessionArchive(
        storageBucketService,
        sessionDirPath,
        sessionPrefix,
        normalizedSessionId,
      )
      let codexHomeId = restoredThreadId ?? randomUUID()
      let codexHomePath = getSessionStatePath(sessionDirPath, codexHomeId)
      await mkdir(codexHomePath, { recursive: true })

      const mcpServer = await startNlsMcpToolServer({
        sessionId: normalizedSessionId,
        tools: sessionTools,
      })
      let threadId = restoredThreadId
      let sessionError: unknown

      try {
        logger.info(
          'nls session prompt received session_id="%s" prompt_length="%s"',
          normalizedSessionId,
          String(normalizedText.length),
        )

        const responseText = await runCodexThread({
          mcpServer,
          codexHomePath,
          restoredThreadId,
          model,
          providerBaseUrl: llmSecret.endpoint,
          apiKey: llmSecret["api-key"],
          workingDirectory: sessionWorkingDirectory,
          prompt: buildCodexPrompt({
            systemPrompt,
            requestSystemPrompt: args.systemPrompt,
            userPrompt: normalizedText,
          }),
          idleTimeoutMs: args.idleTimeoutMs ?? DEFAULT_LANGUAGE_ENGINE_IDLE_TIMEOUT_MS,
          shouldCancel: args.shouldCancel,
          cancelPollIntervalMs: args.cancelPollIntervalMs,
          onThreadId: nextThreadId => {
            threadId = nextThreadId
          },
          onFrame: args.onFrame,
          sessionId: normalizedSessionId,
        })

        const normalizedResponseText = responseText.trim()
        if (normalizedResponseText.length === 0) {
          throw new Error("NLS returned empty response")
        }

        return normalizedResponseText
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
        await mcpServer.stop().catch(error => {
          logger.warn(
            { error: normalizeError(error) },
            'nls mcp server stop failed session_id="%s"',
            normalizedSessionId,
          )
        })

        const currentThreadId = threadId?.trim()
        if (currentThreadId) {
          try {
            if (currentThreadId !== codexHomeId) {
              const nextCodexHomePath = getSessionStatePath(sessionDirPath, currentThreadId)
              await rm(nextCodexHomePath, { recursive: true, force: true })
              await rename(codexHomePath, nextCodexHomePath)
              codexHomeId = currentThreadId
              codexHomePath = nextCodexHomePath
            }

            await uploadSessionArchive(
              storageBucketService,
              sessionDirPath,
              sessionPrefix,
              normalizedSessionId,
              codexHomeId,
            )
          } catch (error) {
            logger.warn(
              { error: normalizeError(error) },
              'nls session archive upload failed session_id="%s" codex_thread_id="%s" after_error="%s"',
              normalizedSessionId,
              currentThreadId,
              sessionError === undefined ? "false" : "true",
            )
          }
        }
      }
    })
  }
}

async function runCodexThread({
  mcpServer,
  codexHomePath,
  restoredThreadId,
  model,
  providerBaseUrl,
  apiKey,
  workingDirectory,
  prompt,
  idleTimeoutMs,
  shouldCancel,
  cancelPollIntervalMs,
  onThreadId,
  onFrame,
  sessionId,
}: {
  mcpServer: NlsMcpToolServer
  codexHomePath: string
  restoredThreadId?: string
  model: string
  providerBaseUrl: string
  apiKey: string
  workingDirectory: string
  prompt: string
  idleTimeoutMs: number
  shouldCancel?: () => Promise<boolean>
  cancelPollIntervalMs?: number
  onThreadId: (threadId: string) => void
  onFrame?: (frame: { text: string; reset: boolean }) => Promise<void>
  sessionId: string
}): Promise<string> {
  const abortController = new AbortController()
  const stopCancellationWatcher = watchLanguageSessionCancellation({
    abortController,
    shouldCancel,
    pollIntervalMs: cancelPollIntervalMs,
  })
  const timeout = createIdleTimeout(idleTimeoutMs, abortController)
  const frameQueue = createFrameQueue(onFrame)

  try {
    const codex = new Codex({
      apiKey,
      env: createCodexEnvironment(codexHomePath, mcpServer.token),
      config: createCodexConfig(mcpServer, providerBaseUrl),
    })
    const threadOptions = {
      model,
      sandboxMode: "danger-full-access" as const,
      approvalPolicy: "never" as const,
      networkAccessEnabled: true,
      webSearchMode: "live" as const,
      workingDirectory,
      skipGitRepoCheck: true,
    }
    const thread = restoredThreadId
      ? codex.resumeThread(restoredThreadId, threadOptions)
      : codex.startThread(threadOptions)
    const { events } = await thread.runStreamed(prompt, { signal: abortController.signal })
    let finalResponse = ""
    let failure: Error | undefined

    for await (const event of events) {
      timeout.reset()
      const eventFailure = await handleCodexEvent({
        event,
        sessionId,
        onThreadId,
        frameQueue,
        currentFinalResponse: finalResponse,
      })

      if (event.type === "item.completed" && event.item.type === "agent_message") {
        finalResponse = event.item.text
      }

      if (eventFailure) {
        failure = eventFailure
        break
      }
    }

    await frameQueue.flush(finalResponse)

    if (failure) {
      throw failure
    }

    return finalResponse
  } finally {
    timeout.stop()
    stopCancellationWatcher()
  }
}

async function handleCodexEvent({
  event,
  sessionId,
  onThreadId,
  frameQueue,
  currentFinalResponse,
}: {
  event: ThreadEvent
  sessionId: string
  onThreadId: (threadId: string) => void
  frameQueue: LanguageEngineFrameQueue
  currentFinalResponse: string
}): Promise<Error | undefined> {
  if (event.type === "thread.started") {
    onThreadId(event.thread_id)
    return undefined
  }

  if (event.type === "turn.failed") {
    return new Error(event.error.message)
  }

  if (event.type === "error") {
    return new Error(event.message)
  }

  if (
    event.type !== "item.started" &&
    event.type !== "item.updated" &&
    event.type !== "item.completed"
  ) {
    return undefined
  }

  logCodexItem(event.item, event.type, sessionId)

  if (event.item.type === "agent_message" && event.item.text !== currentFinalResponse) {
    frameQueue.push(event.item.id, event.item.text)
  }

  return undefined
}

function logCodexItem(item: ThreadItem, eventType: string, sessionId: string): void {
  if (item.type === "agent_message") {
    logger.info(
      'nls assistant message session_id="%s" event_type="%s" message_id="%s" content_length="%s"',
      sessionId,
      eventType,
      item.id,
      String(item.text.length),
    )
    return
  }

  if (item.type === "mcp_tool_call") {
    logger.info(
      'nls tool execution session_id="%s" event_type="%s" tool_name="%s" tool_call_id="%s" status="%s"',
      sessionId,
      eventType,
      item.tool,
      item.id,
      item.status,
    )
    return
  }

  if (item.type === "command_execution") {
    logger.info(
      'nls command execution session_id="%s" event_type="%s" command_id="%s" status="%s" exit_code="%s" output_length="%s"',
      sessionId,
      eventType,
      item.id,
      item.status,
      item.exit_code === undefined ? "unknown" : String(item.exit_code),
      String(item.aggregated_output.length),
    )
    return
  }

  if (item.type === "file_change") {
    logger.info(
      'nls file change session_id="%s" event_type="%s" item_id="%s" status="%s" files_count="%s"',
      sessionId,
      eventType,
      item.id,
      item.status,
      String(item.changes.length),
    )
    return
  }

  if (item.type === "web_search") {
    logger.info(
      'nls web search session_id="%s" event_type="%s" item_id="%s" query_length="%s"',
      sessionId,
      eventType,
      item.id,
      String(item.query.length),
    )
    return
  }

  if (item.type === "error") {
    logger.warn(
      'nls codex item error session_id="%s" event_type="%s" item_id="%s" message="%s"',
      sessionId,
      eventType,
      item.id,
      truncateOneLine(item.message, 400),
    )
  }
}

type LanguageEngineFrameQueue = {
  push: (messageId: string, text: string) => void
  flush: (finalText: string) => Promise<void>
}

function createFrameQueue(
  onFrame: ((frame: { text: string; reset: boolean }) => Promise<void>) | undefined,
): LanguageEngineFrameQueue {
  let frameChain = Promise.resolve()
  let hasStreamedFrame = false
  let lastStreamedText = ""
  let currentStreamMessageId: string | undefined

  const queueFrame = (messageId: string, text: string) => {
    if (!onFrame || text.length === 0) {
      return
    }

    const reset = currentStreamMessageId !== messageId
    currentStreamMessageId = messageId
    frameChain = frameChain
      .then(async () => {
        hasStreamedFrame = true
        lastStreamedText = text
        await onFrame({ text, reset })
      })
      .catch(error => {
        logger.warn({ error: normalizeError(error) }, "nls stream frame callback failed")
      })
  }

  return {
    push: queueFrame,
    flush: async finalText => {
      if (!onFrame) {
        return
      }

      await frameChain

      if (!hasStreamedFrame || lastStreamedText !== finalText) {
        await onFrame({
          text: finalText,
          reset: !hasStreamedFrame,
        })
      }
    },
  }
}

function buildCodexPrompt({
  systemPrompt,
  requestSystemPrompt,
  userPrompt,
}: {
  systemPrompt: string
  requestSystemPrompt?: string
  userPrompt: string
}): string {
  return [
    "System instructions for this ReSide NLS session:",
    [systemPrompt, requestSystemPrompt?.trim()].filter(Boolean).join("\n\n"),
    "User prompt:",
    userPrompt,
  ].join("\n\n")
}

function createCodexConfig(
  mcpServer: NlsMcpToolServer,
  providerBaseUrl: string,
): CodexConfigObject {
  return {
    approval_policy: "never",
    sandbox_mode: "danger-full-access",
    model_provider: CODEX_MODEL_PROVIDER_ID,
    model_providers: {
      [CODEX_MODEL_PROVIDER_ID]: {
        name: "ReSide LLM",
        base_url: providerBaseUrl,
        env_key: "CODEX_API_KEY",
        wire_api: "responses",
      },
    },
    web_search: "live",
    mcp_servers: {
      [mcpServer.name]: {
        url: mcpServer.url,
        bearer_token_env_var: MCP_TOKEN_ENV_VAR,
        enabled: true,
        required: true,
        enabled_tools: mcpServer.toolNames,
        default_tools_approval_mode: "approve",
        startup_timeout_sec: 5,
        tool_timeout_sec: 600,
      },
    },
  }
}

function createCodexEnvironment(codexHomePath: string, mcpToken: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }

  env.CODEX_HOME = codexHomePath
  env[MCP_TOKEN_ENV_VAR] = mcpToken

  return env
}

function watchLanguageSessionCancellation({
  abortController,
  shouldCancel,
  pollIntervalMs,
}: {
  abortController: AbortController
  shouldCancel?: () => Promise<boolean>
  pollIntervalMs?: number
}): () => void {
  if (!shouldCancel) {
    return () => undefined
  }

  let stopped = false
  const intervalMs = Math.max(250, pollIntervalMs ?? 1000)

  const loop = async () => {
    while (!stopped && !abortController.signal.aborted) {
      await Bun.sleep(intervalMs)
      if (stopped || abortController.signal.aborted) {
        return
      }

      try {
        if (await shouldCancel()) {
          abortController.abort()
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

function createIdleTimeout(
  idleTimeoutMs: number,
  abortController: AbortController,
): { reset: () => void; stop: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const stop = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
      timeoutId = undefined
    }
  }

  const reset = () => {
    stop()
    timeoutId = setTimeout(() => {
      abortController.abort(
        new Error(`Timeout after ${idleTimeoutMs}ms without Codex session activity`),
      )
    }, idleTimeoutMs)
  }

  reset()

  return { reset, stop }
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

function truncateOneLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength)}...`
}

function sanitizeFilePart(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, "_")
}
