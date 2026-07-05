import type {
  Config,
  Event as OpenCodeEvent,
  OpencodeClient,
  Part,
  SessionPromptResponse,
} from "@opencode-ai/sdk/v2"
import type { Pool } from "pg"
import type { CommonServices } from "../services"
import type { Tool } from "./tool"
import { randomUUID, webcrypto } from "node:crypto"
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk/v2"
import { z } from "zod"
import { createStorageBucketService, type StorageBucketService } from "../database"
import { crypto } from "../encryption"
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
const NLS_CHAT_WORKSPACE_DIR = "chat-workspace"
const NLS_HOME_DIR = ".reside-nls"
const STORAGE_INIT_RETRY_MS = 1000
const STORAGE_INIT_MAX_ATTEMPTS = 5
const STORAGE_OPERATION_WAIT_TIMEOUT_MS = 30_000
const DEFAULT_LANGUAGE_ENGINE_IDLE_TIMEOUT_MS = 120_000
const LLM_SECRET_NAME = "llm"
const OPENCODE_MODEL_PROVIDER_ID = "reside"
const OPENCODE_CONFIG_PATH = ".opencode/opencode.json"
const RESIDE_LLM_ENDPOINT_ENV_VAR = "RESIDE_LLM_ENDPOINT"
const RESIDE_LLM_API_KEY_ENV_VAR = "RESIDE_LLM_API_KEY"
const COMMAND_LOG_MAX_LENGTH = 500
const COMMAND_OUTPUT_TAIL_MAX_LENGTH = 2000
const OPENCODE_EVENT_DIAGNOSTIC_INTERVAL_MS = 60_000

export type LanguageEngineModelTier = "light" | "smart"

type OpenCodeReasoningEffort = "low" | "medium" | "high" | "xhigh"

export type LanguageEngineReasoningEffort = "minimal" | OpenCodeReasoningEffort

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
  invocationId?: string
  opencodeSessionId?: string
  systemPrompt?: string
  workingDirectory?: string
  configDir?: string
  reasoningEffort?: LanguageEngineReasoningEffort
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
  opencodeEndpoint?: string
}

type OpenCodeTurnStatus = "completed" | "failed"

type OpenCodeTurnMetrics = {
  turnStartedAt?: number
  usage?: OpenCodeUsage
  toolStartTimes: Map<string, number>
  commandStartTimes: Map<string, number>
  toolCallsCount: number
  failedToolCallsCount: number
  commandsCount: number
  failedCommandsCount: number
  totalCommandOutputLength: number
  largestCommandOutputLength: number
}

type OpenCodeUsage = {
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
  }
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
  const opencodeEndpoint = args.opencodeEndpoint
  const usesRemoteOpenCode = opencodeEndpoint !== undefined
  const opencodeConfig = usesRemoteOpenCode ? {} : await loadOpenCodeConfig(model)
  if (systemPrompt.length === 0) {
    throw new Error("createLanguageEngine systemPrompt must not be empty")
  }

  const workspacePath = getNlsRootPath(sessionPrefix)
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
        invocationId: options?.invocationId,
        opencodeSessionId: options?.opencodeSessionId,
        systemPrompt: options?.systemPrompt,
        workingDirectory: options?.workingDirectory,
        configDir: options?.configDir,
        reasoningEffort: options?.reasoningEffort,
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
        invocationId: options?.invocationId,
        opencodeSessionId: options?.opencodeSessionId,
        systemPrompt: options?.systemPrompt,
        workingDirectory: options?.workingDirectory,
        configDir: options?.configDir,
        reasoningEffort: options?.reasoningEffort,
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
    invocationId?: string
    opencodeSessionId?: string
    systemPrompt?: string
    workingDirectory?: string
    configDir?: string
    reasoningEffort?: LanguageEngineReasoningEffort
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
      const sessionWorkingDirectory =
        args.workingDirectory ?? join(workspacePath, NLS_CHAT_WORKSPACE_DIR)
      const sessionDirPath = args.configDir ?? join(workspacePath, NLS_SESSION_DIR)
      if (!usesRemoteOpenCode) {
        await mkdir(sessionWorkingDirectory, { recursive: true })
      }
      await mkdir(sessionDirPath, { recursive: true })

      const sessionTools = [...engineTools, ...(args.tools ?? [])]
      const invocationId = args.invocationId ?? randomUUID()
      const restoredThreadId =
        args.opencodeSessionId ??
        (usesRemoteOpenCode
          ? undefined
          : await restoreSessionArchive(
              storageBucketService,
              sessionDirPath,
              sessionPrefix,
              normalizedSessionId,
            ))
      let opencodeSessionId = restoredThreadId ?? randomUUID()
      let opencodeStatePath = getSessionStatePath(sessionDirPath, opencodeSessionId)
      await mkdir(opencodeStatePath, { recursive: true })

      const mcpServer = await startNlsMcpToolServer({
        invocationId,
        tools: sessionTools,
      })
      logger.debug(
        'nls mcp server started session_id="%s" url="%s" tools="%s"',
        normalizedSessionId,
        mcpServer.url,
        mcpServer.toolNames.join(","),
      )
      let currentOpenCodeSessionId = restoredThreadId
      let sessionError: unknown

      try {
        logger.info(
          'nls session prompt received session_id="%s" prompt_length="%s"',
          normalizedSessionId,
          String(normalizedText.length),
        )

        const responseText = await runOpenCodeSession({
          mcpServer,
          opencodeSessionId,
          opencodeStatePath,
          restoredThreadId,
          model,
          opencodeConfig,
          providerBaseUrl: llmSecret.endpoint,
          apiKey: llmSecret["api-key"],
          opencodeEndpoint,
          homeDir: opencodeStatePath,
          workingDirectory: sessionWorkingDirectory,
          reasoningEffort: args.reasoningEffort,
          systemPrompt: buildOpenCodeSystemPrompt({
            systemPrompt,
            requestSystemPrompt: args.systemPrompt,
            invocationId,
          }),
          userPrompt: normalizedText,
          idleTimeoutMs: args.idleTimeoutMs ?? DEFAULT_LANGUAGE_ENGINE_IDLE_TIMEOUT_MS,
          shouldCancel: args.shouldCancel,
          cancelPollIntervalMs: args.cancelPollIntervalMs,
          onSessionId: nextSessionId => {
            currentOpenCodeSessionId = nextSessionId
          },
          onFrame: args.onFrame,
          sessionId: normalizedSessionId,
        })

        const normalizedResponseText = responseText.trim()
        if (normalizedResponseText.length === 0) {
          throw new Error("NLS returned empty response")
        }

        logger.info(
          'nls session response completed session_id="%s" response_length="%s"',
          normalizedSessionId,
          String(normalizedResponseText.length),
        )

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

        const currentSessionId = currentOpenCodeSessionId?.trim()
        if (currentSessionId && !usesRemoteOpenCode) {
          const archiveUploadStartedAt = Date.now()
          try {
            if (currentSessionId !== opencodeSessionId) {
              const nextOpenCodeStatePath = getSessionStatePath(sessionDirPath, currentSessionId)
              await rm(nextOpenCodeStatePath, { recursive: true, force: true })
              await rename(opencodeStatePath, nextOpenCodeStatePath)
              opencodeSessionId = currentSessionId
              opencodeStatePath = nextOpenCodeStatePath
            }

            const archiveUploaded = await uploadSessionArchive(
              storageBucketService,
              sessionDirPath,
              sessionPrefix,
              normalizedSessionId,
              opencodeSessionId,
            )
            if (archiveUploaded) {
              logger.info(
                'nls session archive upload completed session_id="%s" opencode_session_id="%s" duration_ms="%s"',
                normalizedSessionId,
                currentSessionId,
                String(Date.now() - archiveUploadStartedAt),
              )
            } else {
              logger.debug(
                'nls session archive upload skipped session_id="%s" opencode_session_id="%s" duration_ms="%s"',
                normalizedSessionId,
                currentSessionId,
                String(Date.now() - archiveUploadStartedAt),
              )
            }
          } catch (error) {
            logger.warn(
              { error: normalizeError(error) },
              'nls session archive upload failed session_id="%s" opencode_session_id="%s" after_error="%s" duration_ms="%s"',
              normalizedSessionId,
              currentSessionId,
              sessionError === undefined ? "false" : "true",
              String(Date.now() - archiveUploadStartedAt),
            )
          }
        }
      }
    })
  }
}

async function runOpenCodeSession({
  mcpServer,
  opencodeSessionId,
  opencodeStatePath,
  restoredThreadId,
  model,
  opencodeConfig,
  providerBaseUrl,
  apiKey,
  opencodeEndpoint,
  homeDir,
  workingDirectory,
  reasoningEffort,
  systemPrompt,
  userPrompt,
  idleTimeoutMs,
  shouldCancel,
  cancelPollIntervalMs,
  onSessionId,
  onFrame,
  sessionId,
}: {
  mcpServer: NlsMcpToolServer
  opencodeSessionId: string
  opencodeStatePath: string
  restoredThreadId?: string
  model: string
  opencodeConfig: Config
  providerBaseUrl: string
  apiKey: string
  opencodeEndpoint?: string
  homeDir: string
  workingDirectory: string
  reasoningEffort?: LanguageEngineReasoningEffort
  systemPrompt: string
  userPrompt: string
  idleTimeoutMs: number
  shouldCancel?: () => Promise<boolean>
  cancelPollIntervalMs?: number
  onSessionId: (sessionId: string) => void
  onFrame?: (frame: { text: string; reset: boolean }) => Promise<void>
  sessionId: string
}): Promise<string> {
  const abortController = new AbortController()
  const eventAbortController = new AbortController()
  const stopCancellationWatcher = watchLanguageSessionCancellation({
    abortController,
    shouldCancel,
    pollIntervalMs: cancelPollIntervalMs,
  })
  const timeout = createIdleTimeout(idleTimeoutMs, abortController)
  const frameQueue = createFrameQueue(onFrame)
  const turnMetrics = createOpenCodeTurnMetrics()
  const sessionStartedAt = Date.now()
  let activeOpenCodeSessionId = restoredThreadId ?? opencodeSessionId
  let finalResponse = ""
  let status: OpenCodeTurnStatus = "failed"
  const serverAbortController = new AbortController()
  let eventWatcher: Promise<void> | undefined
  const opencode = await createOpenCodeSessionBackend({
    endpoint: opencodeEndpoint,
    providerBaseUrl,
    apiKey,
    homeDir,
    workingDirectory,
    signal: serverAbortController.signal,
    config: createOpenCodeSessionConfig(opencodeConfig, mcpServer, model),
  })

  try {
    await mkdir(opencodeStatePath, { recursive: true })
    const session = restoredThreadId
      ? await opencode.client.session.get({
          sessionID: restoredThreadId,
          directory: workingDirectory,
        })
      : await opencode.client.session.create({
          directory: workingDirectory,
          title: `ReSide NLS ${sessionId}`,
          agent: "build",
          model: { id: model, providerID: OPENCODE_MODEL_PROVIDER_ID },
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
    if (session.error) {
      throw new Error(formatOpenCodeError(session.error))
    }

    activeOpenCodeSessionId = session.data.id
    onSessionId(activeOpenCodeSessionId)
    turnMetrics.turnStartedAt = Date.now()
    logger.info('nls turn started session_id="%s"', sessionId)
    eventWatcher = watchOpenCodeEvents({
      opencode,
      sessionId,
      opencodeSessionId: activeOpenCodeSessionId,
      workingDirectory,
      frameQueue,
      onActivity: timeout.reset,
      signal: eventAbortController.signal,
    })

    const abortPromise = waitForAbort(abortController.signal).then(async () => {
      await opencode.client.session.abort({
        sessionID: activeOpenCodeSessionId,
        directory: workingDirectory,
      })
      throw normalizeAbortReason(abortController.signal.reason)
    })
    const promptPromise = opencode.client.session.prompt(
      {
        sessionID: activeOpenCodeSessionId,
        directory: workingDirectory,
        agent: "build",
        model: { providerID: OPENCODE_MODEL_PROVIDER_ID, modelID: model },
        system: systemPrompt,
        parts: [{ type: "text", text: userPrompt }],
        ...(reasoningEffort ? { variant: reasoningEffort } : {}),
      },
      { signal: abortController.signal },
    )
    const result = await Promise.race([promptPromise, abortPromise])
    timeout.reset()
    if (result.error) {
      throw new Error(formatOpenCodeError(result.error))
    }

    finalResponse = extractOpenCodeResponseText(result.data)
    collectOpenCodeMetrics(result.data, turnMetrics)
    await logOpenCodeParts(result.data.parts, sessionId, turnMetrics, workingDirectory)

    await frameQueue.flush(finalResponse)

    status = "completed"
    return finalResponse
  } finally {
    eventAbortController.abort()
    await eventWatcher?.catch(error => {
      logger.warn({ error: normalizeError(error) }, "nls opencode event watcher failed")
    })
    timeout.stop()
    stopCancellationWatcher()
    opencode.close()
    serverAbortController.abort()
    logOpenCodeTurnSummary({
      sessionId,
      opencodeSessionId: activeOpenCodeSessionId,
      model,
      reasoningEffort,
      mcpServer,
      responseText: finalResponse,
      metrics: turnMetrics,
      durationMs: Date.now() - sessionStartedAt,
      status,
    })
  }
}

async function createOpenCodeSessionBackend({
  endpoint,
  providerBaseUrl,
  apiKey,
  homeDir,
  workingDirectory,
  signal,
  config,
}: {
  endpoint?: string
  providerBaseUrl: string
  apiKey: string
  homeDir: string
  workingDirectory: string
  signal: AbortSignal
  config: Config
}): Promise<{ client: OpencodeClient; close: () => void }> {
  if (endpoint !== undefined) {
    const client = createOpencodeClient({
      baseUrl: endpoint,
      directory: workingDirectory,
    })

    return {
      client,
      close: () => undefined,
    }
  }

  const restoreEnvironment = setOpenCodeEnvironment({
    providerBaseUrl,
    apiKey,
    homeDir,
  })
  const opencode = await createOpencode({
    port: 0,
    signal,
    config,
  }).finally(restoreEnvironment)

  return {
    client: opencode.client,
    close: () => opencode.server.close(),
  }
}

function createOpenCodeTurnMetrics(): OpenCodeTurnMetrics {
  return {
    toolStartTimes: new Map(),
    commandStartTimes: new Map(),
    toolCallsCount: 0,
    failedToolCallsCount: 0,
    commandsCount: 0,
    failedCommandsCount: 0,
    totalCommandOutputLength: 0,
    largestCommandOutputLength: 0,
  }
}

function tailString(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return value.slice(value.length - maxLength)
}

async function loadOpenCodeConfig(model: string): Promise<Config> {
  const rawConfig = await readFile(OPENCODE_CONFIG_PATH, "utf8")
  const config = JSON.parse(stripJsonCommentsAndTrailingCommas(rawConfig)) as Config
  const provider = config.provider?.[OPENCODE_MODEL_PROVIDER_ID]
  if (!provider?.models?.[model]) {
    throw new Error(
      `OpenCode config provider "${OPENCODE_MODEL_PROVIDER_ID}" does not define model "${model}"`,
    )
  }

  return config
}

function createOpenCodeSessionConfig(
  baseConfig: Config,
  mcpServer: NlsMcpToolServer,
  model: string,
): Config {
  return {
    ...baseConfig,
    model: `${OPENCODE_MODEL_PROVIDER_ID}/${model}`,
    mcp: {
      ...baseConfig.mcp,
      [mcpServer.name]: {
        type: "remote",
        url: mcpServer.url,
        enabled: true,
        headers: {
          authorization: `Bearer ${mcpServer.token}`,
        },
        oauth: false,
        timeout: 600_000,
      },
    },
  }
}

function setOpenCodeEnvironment({
  providerBaseUrl,
  apiKey,
  homeDir,
}: {
  providerBaseUrl: string
  apiKey: string
  homeDir: string
}): () => void {
  const previousEndpoint = process.env[RESIDE_LLM_ENDPOINT_ENV_VAR]
  const previousApiKey = process.env[RESIDE_LLM_API_KEY_ENV_VAR]
  const previousHome = process.env.HOME
  process.env[RESIDE_LLM_ENDPOINT_ENV_VAR] = providerBaseUrl
  process.env[RESIDE_LLM_API_KEY_ENV_VAR] = apiKey
  process.env.HOME = homeDir

  return () => {
    restoreEnvironmentValue(RESIDE_LLM_ENDPOINT_ENV_VAR, previousEndpoint)
    restoreEnvironmentValue(RESIDE_LLM_API_KEY_ENV_VAR, previousApiKey)
    restoreEnvironmentValue("HOME", previousHome)
  }
}

function restoreEnvironmentValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}

function stripJsonCommentsAndTrailingCommas(value: string): string {
  return value.replaceAll(/,\s*([}\]])/g, "$1")
}

function extractOpenCodeResponseText(response: SessionPromptResponse): string {
  return response.parts
    .filter(part => part.type === "text")
    .map(part => part.text)
    .join("\n")
}

function collectOpenCodeMetrics(
  response: SessionPromptResponse,
  metrics: OpenCodeTurnMetrics,
): void {
  metrics.usage = {
    input: response.info.tokens.input,
    output: response.info.tokens.output,
    reasoning: response.info.tokens.reasoning,
    cache: {
      read: response.info.tokens.cache.read,
    },
  }
}

async function watchOpenCodeEvents({
  opencode,
  sessionId,
  opencodeSessionId,
  workingDirectory,
  frameQueue,
  onActivity,
  signal,
}: {
  opencode: { client: OpencodeClient }
  sessionId: string
  opencodeSessionId: string
  workingDirectory: string
  frameQueue: LanguageEngineFrameQueue
  onActivity: () => void
  signal: AbortSignal
}): Promise<void> {
  const events = await opencode.client.event.subscribe(
    { directory: workingDirectory },
    {
      signal,
      sseMaxRetryAttempts: 0,
    },
  )
  const diagnosticLoggedAtByKey = new Map<string, number>()

  try {
    for await (const event of events.stream) {
      if (signal.aborted) {
        return
      }

      const eventSessionId = getOpenCodeEventSessionId(event)
      const eventLogged = logOpenCodeEvent(event, sessionId, opencodeSessionId, frameQueue)
      logOpenCodeEventDiagnostic({
        event,
        eventSessionId,
        expectedOpenCodeSessionId: opencodeSessionId,
        sessionId,
        matchedSession: eventLogged,
        loggedAtByKey: diagnosticLoggedAtByKey,
      })

      if (eventLogged) {
        onActivity()
      }
    }
  } catch (error) {
    if (signal.aborted) {
      return
    }

    throw error
  }
}

function logOpenCodeEventDiagnostic({
  event,
  eventSessionId,
  expectedOpenCodeSessionId,
  sessionId,
  matchedSession,
  loggedAtByKey,
}: {
  event: OpenCodeEvent
  eventSessionId?: string
  expectedOpenCodeSessionId: string
  sessionId: string
  matchedSession: boolean
  loggedAtByKey: Map<string, number>
}): void {
  const eventPartType = getOpenCodeEventPartType(event)
  const key = [
    event.type,
    eventSessionId ?? "missing",
    eventPartType ?? "none",
    matchedSession ? "matched" : "unmatched",
  ].join(":")
  const now = Date.now()
  const loggedAt = loggedAtByKey.get(key)
  if (loggedAt !== undefined && now - loggedAt < OPENCODE_EVENT_DIAGNOSTIC_INTERVAL_MS) {
    return
  }

  loggedAtByKey.set(key, now)
  logger.debug(
    'nls opencode event observed session_id="%s" opencode_session_id="%s" event_type="%s" event_session_id="%s" part_type="%s" matched_session="%s"',
    sessionId,
    expectedOpenCodeSessionId,
    event.type,
    eventSessionId ?? "unknown",
    eventPartType ?? "none",
    String(matchedSession),
  )
}

function logOpenCodeEvent(
  event: OpenCodeEvent,
  sessionId: string,
  opencodeSessionId: string,
  frameQueue: LanguageEngineFrameQueue,
): boolean {
  if (!isEventForSession(event, opencodeSessionId)) {
    return false
  }

  if (event.type === "message.part.updated") {
    const part = event.properties.part
    if (part.type === "text") {
      frameQueue.push(part.messageID, part.text)
      logger.debug(
        'nls opencode assistant message updated session_id="%s" opencode_session_id="%s" message_id="%s" part_id="%s" content_length="%s"',
        sessionId,
        opencodeSessionId,
        part.messageID,
        part.id,
        String(part.text.length),
      )
      return true
    }

    if (part.type === "tool") {
      logOpenCodeToolPartUpdate(part, sessionId, opencodeSessionId)
      return true
    }

    if (part.type !== "patch") {
      return true
    }

    logger.info(
      'nls opencode file change session_id="%s" opencode_session_id="%s" message_id="%s" part_id="%s" files_count="%s"',
      sessionId,
      opencodeSessionId,
      event.properties.part.messageID,
      event.properties.part.id,
      String(part.files.length),
    )
    return true
  }

  return true
}

function logOpenCodeToolPartUpdate(
  part: Extract<Part, { type: "tool" }>,
  sessionId: string,
  opencodeSessionId: string,
): void {
  const durationMs = getOpenCodeToolDuration(part)
  logger.info(
    'nls opencode tool update session_id="%s" opencode_session_id="%s" message_id="%s" part_id="%s" tool_name="%s" tool_call_id="%s" status="%s" duration_ms="%s"',
    sessionId,
    opencodeSessionId,
    part.messageID,
    part.id,
    part.tool,
    part.callID,
    part.state.status,
    durationMs,
  )

  if (part.tool !== "bash" && part.tool !== "shell") {
    return
  }

  logger.info(
    'nls opencode command update session_id="%s" opencode_session_id="%s" command_id="%s" command="%s" status="%s" duration_ms="%s" output_length="%s" output_tail="%s"',
    sessionId,
    opencodeSessionId,
    part.callID,
    formatCommandForLog(getOpenCodeToolCommand(part)),
    part.state.status,
    durationMs,
    String(getOpenCodeToolOutput(part).length),
    formatCommandOutputTailForLog(getOpenCodeToolOutput(part)),
  )
}

function isEventForSession(event: OpenCodeEvent, opencodeSessionId: string): boolean {
  return getOpenCodeEventSessionId(event) === opencodeSessionId
}

function getOpenCodeEventSessionId(event: OpenCodeEvent): string | undefined {
  if (
    !event.properties ||
    typeof event.properties !== "object" ||
    !("sessionID" in event.properties)
  ) {
    return undefined
  }

  const sessionId = event.properties.sessionID
  return typeof sessionId === "string" ? sessionId : undefined
}

function getOpenCodeEventPartType(event: OpenCodeEvent): string | undefined {
  if (event.type !== "message.part.updated") {
    return undefined
  }

  return event.properties.part.type
}

function _getOpenCodeEventErrorName(error: unknown): string {
  if (!error || typeof error !== "object" || !("name" in error)) {
    return "unknown"
  }

  const name = error.name
  return typeof name === "string" ? name : "unknown"
}

async function logOpenCodeParts(
  parts: Part[],
  sessionId: string,
  metrics: OpenCodeTurnMetrics,
  workingDirectory: string,
): Promise<void> {
  for (const part of parts) {
    if (part.type === "text") {
      logger.info(
        'nls assistant message session_id="%s" message_id="%s" content_length="%s" text="%s"',
        sessionId,
        part.messageID,
        String(part.text.length),
        part.text,
      )
      continue
    }

    if (part.type === "tool") {
      logOpenCodeToolPart(part, sessionId, metrics, workingDirectory)
      continue
    }

    if (part.type === "patch") {
      logger.info(
        'nls file change session_id="%s" part_id="%s" files_count="%s"',
        sessionId,
        part.id,
        String(part.files.length),
      )
    }
  }
}

function logOpenCodeToolPart(
  part: Extract<Part, { type: "tool" }>,
  sessionId: string,
  metrics: OpenCodeTurnMetrics,
  workingDirectory: string,
): void {
  metrics.toolCallsCount += 1
  if (part.state.status === "error") {
    metrics.failedToolCallsCount += 1
  }

  const durationMs = getOpenCodeToolDuration(part)
  logger.info(
    'nls tool execution session_id="%s" tool_name="%s" tool_call_id="%s" status="%s" duration_ms="%s"',
    sessionId,
    part.tool,
    part.callID,
    part.state.status,
    durationMs,
  )

  if (part.tool !== "bash" && part.tool !== "shell") {
    return
  }

  metrics.commandsCount += 1
  if (part.state.status === "error") {
    metrics.failedCommandsCount += 1
  }

  const command = formatCommandForLog(getOpenCodeToolCommand(part))
  const output = getOpenCodeToolOutput(part)
  metrics.totalCommandOutputLength += output.length
  metrics.largestCommandOutputLength = Math.max(metrics.largestCommandOutputLength, output.length)
  logger.info(
    'nls command execution session_id="%s" command_id="%s" command="%s" cwd="%s" status="%s" duration_ms="%s" output_length="%s" output_tail="%s"',
    sessionId,
    part.callID,
    command,
    workingDirectory,
    part.state.status,
    durationMs,
    String(output.length),
    formatCommandOutputTailForLog(output),
  )
}

function getOpenCodeToolCommand(part: Extract<Part, { type: "tool" }>): string {
  if (part.state.status === "pending") {
    return part.state.raw
  }

  const command = part.state.input.command ?? part.state.input.description ?? part.tool
  return typeof command === "string" ? command : part.tool
}

function getOpenCodeToolOutput(part: Extract<Part, { type: "tool" }>): string {
  if (part.state.status !== "completed" && part.state.status !== "error") {
    return ""
  }

  return part.state.status === "completed" ? part.state.output : part.state.error
}

function getOpenCodeToolDuration(part: Extract<Part, { type: "tool" }>): string {
  if (part.state.status !== "completed" && part.state.status !== "error") {
    return "unknown"
  }

  return String(part.state.time.end - part.state.time.start)
}

function formatOpenCodeError(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as { data?: { message?: unknown }; message?: unknown; name?: unknown }
    const message = candidate.data?.message ?? candidate.message
    if (typeof message === "string") {
      return message
    }

    if (typeof candidate.name === "string") {
      return candidate.name
    }
  }

  return String(error)
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return
  }

  await new Promise<void>(resolve => {
    signal.addEventListener("abort", () => resolve(), { once: true })
  })
}

function normalizeAbortReason(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason
  }

  return new Error("NLS session aborted")
}

function _formatDurationMs(startedAt: number | undefined): string {
  if (startedAt === undefined) {
    return "unknown"
  }

  return String(Date.now() - startedAt)
}

function formatCommandForLog(command: string): string {
  return truncateOneLine(redactCommandForLog(command), COMMAND_LOG_MAX_LENGTH)
}

function redactCommandForLog(command: string): string {
  return command
    .replaceAll(/x-access-token:[^@\s]+/g, "x-access-token:***")
    .replaceAll(/(token|api[-_]?key|secret|password)=([^\s]+)/gi, "$1=***")
}

function formatCommandOutputTailForLog(output: string): string {
  return tailString(redactCommandForLog(output), COMMAND_OUTPUT_TAIL_MAX_LENGTH)
}

function logOpenCodeTurnSummary({
  sessionId,
  opencodeSessionId,
  model,
  reasoningEffort,
  mcpServer,
  responseText,
  metrics,
  durationMs,
  status,
}: {
  sessionId: string
  opencodeSessionId?: string
  model: string
  reasoningEffort?: LanguageEngineReasoningEffort
  mcpServer: NlsMcpToolServer
  responseText: string
  metrics: OpenCodeTurnMetrics
  durationMs: number
  status: OpenCodeTurnStatus
}): void {
  logger.info(
    'nls turn summary session_id="%s" opencode_session_id="%s" model="%s" reasoning_effort="%s" server_name="%s" tool_count="%s" response_length="%s" input_tokens="%s" cached_input_tokens="%s" output_tokens="%s" reasoning_output_tokens="%s" duration_ms="%s" status="%s" tool_calls_count="%s" failed_tool_calls_count="%s" commands_count="%s" failed_commands_count="%s" total_command_output_length="%s" largest_command_output_length="%s"',
    sessionId,
    opencodeSessionId ?? "unknown",
    model,
    reasoningEffort ?? "default",
    mcpServer.name,
    String(mcpServer.toolNames.length),
    String(responseText.trim().length),
    formatUsageValue(metrics.usage?.input),
    formatUsageValue(metrics.usage?.cache.read),
    formatUsageValue(metrics.usage?.output),
    formatUsageValue(metrics.usage?.reasoning),
    String(durationMs),
    status,
    String(metrics.toolCallsCount),
    String(metrics.failedToolCallsCount),
    String(metrics.commandsCount),
    String(metrics.failedCommandsCount),
    String(metrics.totalCommandOutputLength),
    String(metrics.largestCommandOutputLength),
  )
}

function formatUsageValue(value: number | undefined): string {
  return value === undefined ? "unknown" : String(value)
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

function buildOpenCodeSystemPrompt({
  systemPrompt,
  requestSystemPrompt,
  invocationId,
}: {
  systemPrompt: string
  requestSystemPrompt?: string
  invocationId: string
}): string {
  return [
    "System instructions for this ReSide NLS session:",
    [
      "Current turn context:",
      `- Invocation ID for this user turn: ${invocationId}`,
      "- Pass this invocation ID through unchanged when a tool or downstream operation asks for it.",
    ].join("\n"),
    [systemPrompt, requestSystemPrompt?.trim()].filter(Boolean).join("\n\n"),
  ].join("\n\n")
}

function getNlsRootPath(sessionPrefix: string): string {
  return join(process.env.HOME ?? homedir(), NLS_HOME_DIR, sessionPrefix)
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
        new Error(`Timeout after ${idleTimeoutMs}ms without OpenCode session activity`),
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
      endpoint: credentials.endpoint,
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

export async function restoreSessionArchive(
  storageBucketService: StorageBucketService,
  sessionDirPath: string,
  sessionPrefix: string,
  sessionStorageId: string,
): Promise<string | undefined> {
  const archiveKey = getSessionArchiveKey(sessionPrefix, sessionStorageId)
  const archivePath = join(sessionDirPath, `session.${NLS_SESSION_ARCHIVE_EXTENSION}`)
  await mkdir(sessionDirPath, { recursive: true })

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
  } catch (error) {
    logger.warn(
      { error: normalizeError(error) },
      'nls session archive restore failed key="%s"',
      archiveKey,
    )
    return undefined
  }
}

export async function uploadSessionArchive(
  storageBucketService: StorageBucketService,
  sessionDirPath: string,
  sessionPrefix: string,
  sessionStorageId: string,
  sessionId: string,
): Promise<boolean> {
  const sessionStatePath = getSessionStatePath(sessionDirPath, sessionId)

  try {
    await access(sessionStatePath)
  } catch {
    return false
  }

  if (!(await hasDirectoryContent(sessionStatePath))) {
    return false
  }

  const archivePath = join(
    getNlsRootPath(sessionPrefix),
    `session-upload-${sanitizeFilePart(sessionStorageId)}.${NLS_SESSION_ARCHIVE_EXTENSION}`,
  )
  await mkdir(getNlsRootPath(sessionPrefix), { recursive: true })

  await runCommand([
    "tar",
    "-czf",
    archivePath,
    "-C",
    sessionStatePath,
    "--exclude=./.tmp",
    "--exclude=./.tmp/*",
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
  return true
}

async function hasDirectoryContent(path: string): Promise<boolean> {
  const entries = await readdir(path, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === ".tmp") {
      continue
    }

    if (entry.isFile()) {
      return true
    }

    if (entry.isDirectory() && (await hasDirectoryContent(join(path, entry.name)))) {
      return true
    }
  }

  return false
}

async function clearSessionArchive(
  storageBucketService: StorageBucketService,
  sessionDirPath: string,
  sessionPrefix: string,
  sessionStorageId: string,
): Promise<void> {
  const archiveKey = getSessionArchiveKey(sessionPrefix, sessionStorageId)
  const archivePath = join(
    getNlsRootPath(sessionPrefix),
    `session-clear-${sanitizeFilePart(sessionStorageId)}.${NLS_SESSION_ARCHIVE_EXTENSION}`,
  )
  await mkdir(getNlsRootPath(sessionPrefix), { recursive: true })

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
  if (!candidate || !isValidArchivedSessionId(candidate)) {
    return undefined
  }

  return candidate
}

function isValidArchivedSessionId(sessionId: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId) ||
    /^ses_[a-zA-Z0-9]+$/.test(sessionId)
  )
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
