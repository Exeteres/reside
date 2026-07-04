import type { CommandExecutionItem, ThreadEvent, ThreadItem, Usage } from "@openai/codex-sdk"
import type { Pool } from "pg"
import type { CommonServices } from "../services"
import type { Tool } from "./tool"
import { randomUUID, webcrypto } from "node:crypto"
import { access, chmod, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"
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
import { logger } from "../logger"
import sourceCodexModelCatalogJson from "./codex-models-0.142.5.json"
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
const MCP_TOKEN_ENV_VAR = "RESIDE_NLS_MCP_TOKEN"
const CODEX_MODEL_PROVIDER_ID = "reside"
const CODEX_MODEL_CATALOG_FILE = "model-catalog.json"
const CODEX_DEBUG_DIR = ".tmp"
const CODEX_DEBUG_LOG_DIR = "codex-debug-logs"
const CODEX_PATH_DIR = "codex-path"
const CODEX_APPLY_PATCH_ALIASES = ["apply_patch", "applypatch"]
const CODEX_DEBUG_RUST_LOG = "warn"
const CODEX_DEBUG_LOG_MAX_LENGTH = 100_000
const CODEX_DEBUG_LOG_IGNORED_LINES = new Set(["Reading prompt from stdin..."])
const COMMAND_LOG_MAX_LENGTH = 500
const COMMAND_OUTPUT_TAIL_MAX_LENGTH = 2000
const SOURCE_CODEX_MODEL_CATALOG = sourceCodexModelCatalogJson as CodexModelCatalog

export type LanguageEngineModelTier = "light" | "smart"

type CodexReasoningEffort = "low" | "medium" | "high" | "xhigh"

export type LanguageEngineReasoningEffort = "minimal" | CodexReasoningEffort

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
}

type CodexConfigValue = string | number | boolean | CodexConfigValue[] | CodexConfigObject

type CodexConfigObject = {
  [key: string]: CodexConfigValue
}

type CodexDebugLog = {
  wrapperPath: string
  logPath: string
}

type CodexPathSetup = {
  pathDirPath: string
  codexExecutablePath: string
  aliasPaths: string[]
}

type CodexModelCatalogModel = {
  slug: string
  display_name?: string
  [key: string]: unknown
}

type CodexModelCatalog = {
  models: CodexModelCatalogModel[]
}

type CodexExecutableResolver = {
  exec: {
    executablePath: string
  }
}

type CodexTurnStatus = "completed" | "failed"

type CodexTurnMetrics = {
  turnStartedAt?: number
  usage?: Usage
  toolStartTimes: Map<string, number>
  commandStartTimes: Map<string, number>
  toolCallsCount: number
  failedToolCallsCount: number
  commandsCount: number
  failedCommandsCount: number
  totalCommandOutputLength: number
  largestCommandOutputLength: number
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

  const workspacePath = getNlsRootPath()
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
      await mkdir(sessionWorkingDirectory, { recursive: true })
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
      logger.debug(
        'nls mcp server started session_id="%s" url="%s" tools="%s"',
        normalizedSessionId,
        mcpServer.url,
        mcpServer.toolNames.join(","),
      )
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
          reasoningEffort: args.reasoningEffort,
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

        const currentThreadId = threadId?.trim()
        if (currentThreadId) {
          const archiveUploadStartedAt = Date.now()
          try {
            if (currentThreadId !== codexHomeId) {
              const nextCodexHomePath = getSessionStatePath(sessionDirPath, currentThreadId)
              await rm(nextCodexHomePath, { recursive: true, force: true })
              await rename(codexHomePath, nextCodexHomePath)
              codexHomeId = currentThreadId
              codexHomePath = nextCodexHomePath
            }

            const archiveUploaded = await uploadSessionArchive(
              storageBucketService,
              sessionDirPath,
              sessionPrefix,
              normalizedSessionId,
              codexHomeId,
            )
            if (archiveUploaded) {
              logger.info(
                'nls session archive upload completed session_id="%s" codex_thread_id="%s" duration_ms="%s"',
                normalizedSessionId,
                currentThreadId,
                String(Date.now() - archiveUploadStartedAt),
              )
            } else {
              logger.debug(
                'nls session archive upload skipped session_id="%s" codex_thread_id="%s" duration_ms="%s"',
                normalizedSessionId,
                currentThreadId,
                String(Date.now() - archiveUploadStartedAt),
              )
            }
          } catch (error) {
            logger.warn(
              { error: normalizeError(error) },
              'nls session archive upload failed session_id="%s" codex_thread_id="%s" after_error="%s" duration_ms="%s"',
              normalizedSessionId,
              currentThreadId,
              sessionError === undefined ? "false" : "true",
              String(Date.now() - archiveUploadStartedAt),
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
  reasoningEffort,
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
  reasoningEffort?: LanguageEngineReasoningEffort
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
  const codexDebugLog = await createCodexDebugLog(codexHomePath)
  const codexPathSetup = await createCodexPathDir(codexHomePath)
  const codexEnvironment = createCodexEnvironment(
    codexHomePath,
    mcpServer.token,
    codexPathSetup.pathDirPath,
  )
  const codexPathValue = codexEnvironment.PATH ?? codexPathSetup.pathDirPath
  const codexModelCatalogPath = await createCodexModelCatalog(codexHomePath, model)
  logger.info(
    'nls codex path setup session_id="%s" path_dir="%s" codex_executable="%s" aliases="%s"',
    sessionId,
    codexPathSetup.pathDirPath,
    codexPathSetup.codexExecutablePath,
    codexPathSetup.aliasPaths.join(","),
  )
  const turnMetrics = createCodexTurnMetrics()
  const sessionStartedAt = Date.now()
  let codexThreadId = restoredThreadId
  let finalResponse = ""
  let status: CodexTurnStatus = "failed"

  try {
    const codex = new Codex({
      codexPathOverride: codexDebugLog.wrapperPath,
      apiKey,
      env: codexEnvironment,
      config: createCodexConfig(mcpServer, providerBaseUrl, codexModelCatalogPath, codexPathValue),
    })
    const threadOptions = {
      model,
      sandboxMode: "danger-full-access" as const,
      approvalPolicy: "never" as const,
      networkAccessEnabled: true,
      webSearchMode: "live" as const,
      workingDirectory,
      skipGitRepoCheck: true,
      ...(reasoningEffort ? { modelReasoningEffort: reasoningEffort } : {}),
    }
    const thread = restoredThreadId
      ? codex.resumeThread(restoredThreadId, threadOptions)
      : codex.startThread(threadOptions)
    const { events } = await thread.runStreamed(prompt, { signal: abortController.signal })
    let failure: Error | undefined

    for await (const event of events) {
      timeout.reset()
      const eventFailure = await handleCodexEvent({
        event,
        sessionId,
        onThreadId: nextThreadId => {
          codexThreadId = nextThreadId
          onThreadId(nextThreadId)
        },
        frameQueue,
        currentFinalResponse: finalResponse,
        metrics: turnMetrics,
        workingDirectory,
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

    status = "completed"
    return finalResponse
  } finally {
    timeout.stop()
    stopCancellationWatcher()
    await logCodexDebugLog(sessionId, codexDebugLog.logPath)
    logCodexTurnSummary({
      sessionId,
      codexThreadId,
      model,
      reasoningEffort,
      mcpServer,
      responseText: finalResponse,
      metrics: turnMetrics,
      durationMs: Date.now() - sessionStartedAt,
      codexDebugLogPath: codexDebugLog.logPath,
      status,
    })
  }
}

function createCodexTurnMetrics(): CodexTurnMetrics {
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

async function createCodexDebugLog(codexHomePath: string): Promise<CodexDebugLog> {
  const debugWrapperDirPath = join(codexHomePath, CODEX_DEBUG_DIR)
  const debugLogDirPath = join(getNlsRootPath(), CODEX_DEBUG_LOG_DIR)
  const debugId = randomUUID()
  const wrapperPath = join(debugWrapperDirPath, `codex-debug-${debugId}.sh`)
  const logPath = join(debugLogDirPath, `codex-debug-${debugId}.stderr.log`)
  const codexExecutablePath = resolveCodexExecutablePath()

  await mkdir(debugWrapperDirPath, { recursive: true })
  await mkdir(debugLogDirPath, { recursive: true })
  await writeFile(
    wrapperPath,
    [
      "#!/bin/sh",
      `export RUST_LOG=${quoteShell(CODEX_DEBUG_RUST_LOG)}`,
      "export RUST_BACKTRACE=1",
      `exec ${quoteShell(codexExecutablePath)} "$@" 2>>${quoteShell(logPath)}`,
      "",
    ].join("\n"),
  )
  await chmod(wrapperPath, 0o700)

  return { wrapperPath, logPath }
}

async function createCodexPathDir(codexHomePath: string): Promise<CodexPathSetup> {
  const pathDirPath = join(codexHomePath, CODEX_DEBUG_DIR, CODEX_PATH_DIR)
  const codexExecutablePath = resolveCodexExecutablePath()
  const aliasPaths: string[] = []

  await mkdir(pathDirPath, { recursive: true })

  for (const alias of CODEX_APPLY_PATCH_ALIASES) {
    const aliasPath = join(pathDirPath, alias)
    await rm(aliasPath, { force: true })
    await symlink(codexExecutablePath, aliasPath)
    aliasPaths.push(aliasPath)
  }

  return { pathDirPath, codexExecutablePath, aliasPaths }
}

function resolveCodexExecutablePath(): string {
  const codex = new Codex() as unknown as CodexExecutableResolver
  return codex.exec.executablePath
}

async function logCodexDebugLog(sessionId: string, logPath: string): Promise<void> {
  let text: string
  try {
    text = await readFile(logPath, "utf8")
  } catch (error) {
    logger.warn(
      { error: normalizeError(error) },
      'nls codex debug log read failed session_id="%s" log_path="%s"',
      sessionId,
      logPath,
    )
    return
  }

  const normalizedText = filterCodexDebugLogText(text)
  if (normalizedText.length === 0) {
    logger.debug('nls codex debug log empty session_id="%s" log_path="%s"', sessionId, logPath)
    return
  }

  const truncatedText = tailString(normalizedText, CODEX_DEBUG_LOG_MAX_LENGTH)
  logger.warn(
    'nls codex debug log session_id="%s" log_path="%s" log_length="%s" truncated="%s" text="%s"',
    sessionId,
    logPath,
    String(normalizedText.length),
    normalizedText.length > truncatedText.length ? "true" : "false",
    truncatedText,
  )
}

function filterCodexDebugLogText(text: string): string {
  return text
    .split("\n")
    .filter(line => !CODEX_DEBUG_LOG_IGNORED_LINES.has(line.trim()))
    .join("\n")
    .trim()
}

function tailString(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return value.slice(value.length - maxLength)
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

async function createCodexModelCatalog(codexHomePath: string, model: string): Promise<string> {
  const modelCatalogPath = join(codexHomePath, CODEX_MODEL_CATALOG_FILE)
  const modelCatalog: CodexModelCatalog = {
    models: [createCodexModelCatalogModel(model)],
  }

  await writeFile(modelCatalogPath, JSON.stringify(modelCatalog), "utf8")

  return modelCatalogPath
}

function createCodexModelCatalogModel(model: string): CodexModelCatalogModel {
  const sourceModel = getSourceCodexModelCatalogModel(model)
  const genericModel = createGenericCodexModelCatalogModel(model)
  if (!sourceModel) {
    logger.warn('nls codex model catalog using generic fallback requested_model="%s"', model)

    return genericModel
  }

  logger.info(
    'nls codex model catalog using generic tool config with source model metadata requested_model="%s" source_model="%s"',
    model,
    sourceModel.slug,
  )

  return applySourceCodexModelMetadata(genericModel, sourceModel)
}

function createGenericCodexModelCatalogModel(model: string): CodexModelCatalogModel {
  return {
    slug: model,
    display_name: model,
    description: "ReSide NLS model catalog override.",
    default_reasoning_level: "medium",
    supported_reasoning_levels: [
      { effort: "low", description: "Low" },
      { effort: "medium", description: "Medium" },
      { effort: "high", description: "High" },
      { effort: "xhigh", description: "Extra high" },
    ],
    shell_type: "shell_command",
    visibility: "list",
    supported_in_api: true,
    priority: 0,
    additional_speed_tiers: [],
    service_tiers: [],
    availability_nux: null,
    upgrade: null,
    base_instructions: "",
    model_messages: {
      instructions_template: "{{ personality }}",
      instructions_variables: null,
    },
    supports_reasoning_summaries: true,
    default_reasoning_summary: "none",
    support_verbosity: true,
    default_verbosity: "low",
    apply_patch_tool_type: "freeform",
    web_search_tool_type: "text_and_image",
    truncation_policy: {
      mode: "tokens",
      limit: 10_000,
    },
    supports_parallel_tool_calls: true,
    supports_image_detail_original: true,
    context_window: 272_000,
    max_context_window: 1_000_000,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    input_modalities: ["text", "image"],
    supports_search_tool: false,
    use_responses_lite: false,
  }
}

function applySourceCodexModelMetadata(
  model: CodexModelCatalogModel,
  sourceModel: CodexModelCatalogModel,
): CodexModelCatalogModel {
  const sourceModelMessages = getRecordValue(sourceModel, "model_messages")
  const sourceInstructionsVariables = sourceModelMessages
    ? getRecordValue(sourceModelMessages, "instructions_variables")
    : undefined

  return {
    ...model,
    description: getStringValue(sourceModel, "description") ?? model.description,
    default_reasoning_level:
      getStringValue(sourceModel, "default_reasoning_level") ?? model.default_reasoning_level,
    supported_reasoning_levels:
      getArrayValue(sourceModel, "supported_reasoning_levels") ?? model.supported_reasoning_levels,
    context_window: getNumberValue(sourceModel, "context_window") ?? model.context_window,
    max_context_window:
      getNumberValue(sourceModel, "max_context_window") ?? model.max_context_window,
    supports_reasoning_summaries:
      getBooleanValue(sourceModel, "supports_reasoning_summaries") ??
      model.supports_reasoning_summaries,
    default_reasoning_summary:
      getStringValue(sourceModel, "default_reasoning_summary") ?? model.default_reasoning_summary,
    support_verbosity: getBooleanValue(sourceModel, "support_verbosity") ?? model.support_verbosity,
    default_verbosity: getStringValue(sourceModel, "default_verbosity") ?? model.default_verbosity,
    model_messages: {
      instructions_template: "{{ personality }}",
      instructions_variables: sourceInstructionsVariables ?? null,
    },
  }
}

function getRecordValue(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = source[key]
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}

function getStringValue(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]

  return typeof value === "string" ? value : undefined
}

function getNumberValue(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key]

  return typeof value === "number" ? value : undefined
}

function getBooleanValue(source: Record<string, unknown>, key: string): boolean | undefined {
  const value = source[key]

  return typeof value === "boolean" ? value : undefined
}

function getArrayValue(source: Record<string, unknown>, key: string): unknown[] | undefined {
  const value = source[key]

  return Array.isArray(value) ? value : undefined
}

function getSourceCodexModelCatalogModel(model: string): CodexModelCatalogModel | undefined {
  const modelSlug = getCodexModelSlugSuffix(model)

  return SOURCE_CODEX_MODEL_CATALOG.models.find(sourceModel => sourceModel.slug === modelSlug)
}

function getCodexModelSlugSuffix(model: string): string {
  const separatorIndex = model.lastIndexOf("/")
  if (separatorIndex === -1) {
    return model
  }

  return model.slice(separatorIndex + 1)
}

async function handleCodexEvent({
  event,
  sessionId,
  onThreadId,
  frameQueue,
  currentFinalResponse,
  metrics,
  workingDirectory,
}: {
  event: ThreadEvent
  sessionId: string
  onThreadId: (threadId: string) => void
  frameQueue: LanguageEngineFrameQueue
  currentFinalResponse: string
  metrics: CodexTurnMetrics
  workingDirectory: string
}): Promise<Error | undefined> {
  if (event.type === "thread.started") {
    onThreadId(event.thread_id)
    return undefined
  }

  if (event.type === "turn.started") {
    metrics.turnStartedAt = Date.now()
    logger.info('nls turn started session_id="%s"', sessionId)
    return undefined
  }

  if (event.type === "turn.completed") {
    metrics.usage = event.usage
    logger.info(
      'nls turn completed session_id="%s" input_tokens="%s" cached_input_tokens="%s" output_tokens="%s" reasoning_output_tokens="%s" duration_ms="%s"',
      sessionId,
      String(event.usage.input_tokens),
      String(event.usage.cached_input_tokens),
      String(event.usage.output_tokens),
      String(event.usage.reasoning_output_tokens),
      formatDurationMs(metrics.turnStartedAt),
    )
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

  logCodexItem(event.item, event.type, sessionId, metrics, workingDirectory)

  if (event.item.type === "agent_message" && event.item.text !== currentFinalResponse) {
    frameQueue.push(event.item.id, event.item.text)
  }

  return undefined
}

function logCodexItem(
  item: ThreadItem,
  eventType: string,
  sessionId: string,
  metrics: CodexTurnMetrics,
  workingDirectory: string,
): void {
  if (item.type === "agent_message") {
    logger.info(
      'nls assistant message session_id="%s" event_type="%s" message_id="%s" content_length="%s" text="%s"',
      sessionId,
      eventType,
      item.id,
      String(item.text.length),
      item.text,
    )
    return
  }

  if (item.type === "mcp_tool_call") {
    if (eventType === "item.started") {
      metrics.toolStartTimes.set(item.id, Date.now())
      metrics.toolCallsCount += 1
    }

    const durationMs = formatAndMaybeClearItemDuration(metrics.toolStartTimes, item.id, eventType)
    if (eventType === "item.completed" && item.status === "failed") {
      metrics.failedToolCallsCount += 1
    }

    logger.info(
      'nls tool execution session_id="%s" event_type="%s" server_name="%s" tool_name="%s" tool_call_id="%s" status="%s" duration_ms="%s"',
      sessionId,
      eventType,
      item.server,
      item.tool,
      item.id,
      item.status,
      durationMs,
    )
    return
  }

  if (item.type === "command_execution") {
    if (eventType === "item.started") {
      metrics.commandStartTimes.set(item.id, Date.now())
      metrics.commandsCount += 1
    }

    const outputLength = item.aggregated_output.length
    if (eventType === "item.completed") {
      metrics.totalCommandOutputLength += outputLength
      metrics.largestCommandOutputLength = Math.max(
        metrics.largestCommandOutputLength,
        outputLength,
      )
      if (item.status === "failed" || (item.exit_code !== undefined && item.exit_code !== 0)) {
        metrics.failedCommandsCount += 1
      }
    }

    const durationMs = formatAndMaybeClearItemDuration(
      metrics.commandStartTimes,
      item.id,
      eventType,
    )
    const command = formatCommandForLog(item.command)

    if (eventType === "item.completed" && shouldLogCommandOutputTail(item)) {
      logger.info(
        'nls command execution session_id="%s" event_type="%s" command_id="%s" command="%s" cwd="%s" status="%s" exit_code="%s" duration_ms="%s" output_length="%s" output_tail="%s"',
        sessionId,
        eventType,
        item.id,
        command,
        workingDirectory,
        item.status,
        item.exit_code === undefined ? "unknown" : String(item.exit_code),
        durationMs,
        String(outputLength),
        formatCommandOutputTailForLog(item.aggregated_output),
      )
      return
    }

    logger.info(
      'nls command execution session_id="%s" event_type="%s" command_id="%s" command="%s" cwd="%s" status="%s" exit_code="%s" duration_ms="%s" output_length="%s"',
      sessionId,
      eventType,
      item.id,
      command,
      workingDirectory,
      item.status,
      item.exit_code === undefined ? "unknown" : String(item.exit_code),
      durationMs,
      String(outputLength),
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

function formatAndMaybeClearItemDuration(
  startTimes: Map<string, number>,
  itemId: string,
  eventType: string,
): string {
  const durationMs = formatDurationMs(startTimes.get(itemId))
  if (eventType === "item.completed") {
    startTimes.delete(itemId)
  }

  return durationMs
}

function formatDurationMs(startedAt: number | undefined): string {
  if (startedAt === undefined) {
    return "unknown"
  }

  return String(Date.now() - startedAt)
}

function shouldLogCommandOutputTail(item: CommandExecutionItem): boolean {
  return item.status === "failed" || (item.exit_code !== undefined && item.exit_code !== 0)
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

function logCodexTurnSummary({
  sessionId,
  codexThreadId,
  model,
  reasoningEffort,
  mcpServer,
  responseText,
  metrics,
  durationMs,
  codexDebugLogPath,
  status,
}: {
  sessionId: string
  codexThreadId?: string
  model: string
  reasoningEffort?: LanguageEngineReasoningEffort
  mcpServer: NlsMcpToolServer
  responseText: string
  metrics: CodexTurnMetrics
  durationMs: number
  codexDebugLogPath: string
  status: CodexTurnStatus
}): void {
  logger.info(
    'nls turn summary session_id="%s" codex_thread_id="%s" model="%s" reasoning_effort="%s" server_name="%s" tool_count="%s" response_length="%s" input_tokens="%s" cached_input_tokens="%s" output_tokens="%s" reasoning_output_tokens="%s" duration_ms="%s" codex_debug_log_path="%s" status="%s" tool_calls_count="%s" failed_tool_calls_count="%s" commands_count="%s" failed_commands_count="%s" total_command_output_length="%s" largest_command_output_length="%s"',
    sessionId,
    codexThreadId ?? "unknown",
    model,
    reasoningEffort ?? "default",
    mcpServer.name,
    String(mcpServer.toolNames.length),
    String(responseText.trim().length),
    formatUsageValue(metrics.usage?.input_tokens),
    formatUsageValue(metrics.usage?.cached_input_tokens),
    formatUsageValue(metrics.usage?.output_tokens),
    formatUsageValue(metrics.usage?.reasoning_output_tokens),
    String(durationMs),
    codexDebugLogPath,
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
  modelCatalogPath: string,
  pathValue: string,
): CodexConfigObject {
  return {
    approval_policy: "never",
    sandbox_mode: "danger-full-access",
    analytics: {
      enabled: false,
    },
    feedback: {
      enabled: false,
    },
    features: {
      apply_patch_freeform: true,
      plugins: false,
      plugin_sharing: false,
      remote_plugin: false,
    },
    experimental_use_freeform_apply_patch: true,
    include_apply_patch_tool: true,
    model_catalog_json: modelCatalogPath,
    model_provider: CODEX_MODEL_PROVIDER_ID,
    shell_environment_policy: {
      set: {
        PATH: pathValue,
      },
    },
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
        default_tools_enabled: true,
        enabled_tools: mcpServer.toolNames,
        destructive_enabled: true,
        open_world_enabled: true,
        default_tools_approval_mode: "approve",
        startup_timeout_sec: 5,
        tool_timeout_sec: 600,
      },
    },
  }
}

function createCodexEnvironment(
  codexHomePath: string,
  mcpToken: string,
  pathDirPath: string,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }

  env.PATH = prependPathEntry(pathDirPath, env.PATH)
  env.CODEX_HOME = codexHomePath
  env[MCP_TOKEN_ENV_VAR] = mcpToken

  return env
}

function prependPathEntry(pathEntry: string, pathValue: string | undefined): string {
  return pathValue ? `${pathEntry}${delimiter}${pathValue}` : pathEntry
}

function getNlsRootPath(): string {
  return join(homedir(), NLS_HOME_DIR)
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
): Promise<boolean> {
  const sessionStatePath = getSessionStatePath(sessionDirPath, sessionId)

  try {
    await access(sessionStatePath)
  } catch {
    return false
  }

  const archivePath = join(
    getNlsRootPath(),
    `session-upload-${sanitizeFilePart(sessionStorageId)}.${NLS_SESSION_ARCHIVE_EXTENSION}`,
  )

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

async function clearSessionArchive(
  storageBucketService: StorageBucketService,
  sessionDirPath: string,
  sessionPrefix: string,
  sessionStorageId: string,
): Promise<void> {
  const archiveKey = getSessionArchiveKey(sessionPrefix, sessionStorageId)
  const archivePath = join(
    getNlsRootPath(),
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
