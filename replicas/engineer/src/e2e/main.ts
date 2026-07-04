import type { Config, SessionPromptResponse } from "@opencode-ai/sdk/v2"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOpencode } from "@opencode-ai/sdk/v2"
import { logger, subscribeToSecret } from "@reside/common"
import { toError } from "@reside/utils"
import { z } from "zod"
import { startEngineerAiRuntime } from "../replica"

const llmSecretSchema = z.object({
  endpoint: z.string().trim().min(1),
  "api-key": z.string().trim().min(1),
  "light-model": z.string().trim().min(1),
  "smart-model": z.string().trim().min(1),
})

const runtime = await startEngineerAiRuntime()
const OPENCODE_MODEL_PROVIDER_ID = "reside"
const OPENCODE_CONFIG_PATH = ".opencode/opencode.json"
const RESIDE_LLM_ENDPOINT_ENV_VAR = "RESIDE_LLM_ENDPOINT"
const RESIDE_LLM_API_KEY_ENV_VAR = "RESIDE_LLM_API_KEY"
let exitCode = 0
let workspacePath: string | undefined

try {
  logger.info("starting engineer e2e")

  const repository = await withTimeout(
    runtime.getRepositoryTarget(),
    30_000,
    'Timed out waiting for config map "github-repository"',
  )

  const octokit = await withTimeout(
    waitForReadyValue(() => runtime.getOctokit()),
    30_000,
    'Timed out waiting for secret "github-app" to initialize octokit',
  )

  const llmSecret = await withTimeout(
    waitForLlmSecret(),
    30_000,
    'Timed out waiting for secret "llm"',
  )

  const issuesResponse = await octokit.rest.issues.listForRepo({
    owner: repository.owner,
    repo: repository.name,
    per_page: 2,
    state: "all",
  })

  logger.info(
    'engineer e2e repository issues owner="%s" repo="%s" issues="%s"',
    repository.owner,
    repository.name,
    JSON.stringify(
      issuesResponse.data.map(issue => ({
        number: issue.number,
        state: issue.state,
        title: issue.title,
        url: issue.html_url,
      })),
    ),
  )

  workspacePath = await mkdtemp(join(tmpdir(), "reside-engineer-e2e-"))
  const repositoryPath = join(workspacePath, repository.name)
  await runCommand(["git", "clone", "--depth", "1", repository.cloneUrl, repositoryPath])

  const opencodeConfig = await loadOpenCodeConfig(llmSecret["light-model"])
  const restoreEnvironment = setOpenCodeEnvironment({
    providerBaseUrl: llmSecret.endpoint,
    apiKey: llmSecret["api-key"],
  })
  const opencode = await createOpencode({
    port: 0,
    config: createOpenCodeSessionConfig(opencodeConfig, llmSecret["light-model"]),
  }).finally(restoreEnvironment)
  const session = await opencode.client.session.create({
    directory: repositoryPath,
    title: "Engineer e2e",
    agent: "build",
    model: {
      id: llmSecret["light-model"],
      providerID: OPENCODE_MODEL_PROVIDER_ID,
    },
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  })
  if (session.error) {
    throw new Error(formatOpenCodeError(session.error))
  }

  const agentResponse = await opencode.client.session.prompt({
    sessionID: session.data.id,
    directory: repositoryPath,
    agent: "build",
    model: {
      providerID: OPENCODE_MODEL_PROVIDER_ID,
      modelID: llmSecret["light-model"],
    },
    parts: [{ type: "text", text: "Say hello to engineer replica in one short sentence." }],
  })
  opencode.server.close()
  if (agentResponse.error) {
    throw new Error(formatOpenCodeError(agentResponse.error))
  }

  logger.info('engineer e2e agent response text="%s"', normalizeAgentResponse(agentResponse.data))

  logger.info("engineer e2e completed")
} catch (error) {
  exitCode = 1
  const errorValue = toError(error)

  logger.error({ error: errorValue }, "engineer e2e failed")
} finally {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true })
  }

  try {
    await withTimeout(runtime.stop(), 5_000, "Timed out waiting for runtime stop")
  } catch (error) {
    logger.warn({ error: toError(error) }, "engineer e2e runtime stop warning")
  }

  await Bun.sleep(50)
  process.exit(exitCode)
}

async function waitForLlmSecret(): Promise<z.infer<typeof llmSecretSchema>> {
  const iterator = subscribeToSecret("llm")[Symbol.asyncIterator]()

  try {
    while (true) {
      const next = await iterator.next()
      if (next.done) {
        throw new Error('Secret subscription "llm" ended before a value was received')
      }

      return llmSecretSchema.parse(next.value)
    }
  } finally {
    await iterator.return?.()
  }
}

async function waitForReadyValue<T>(factory: () => T): Promise<T> {
  while (true) {
    try {
      return factory()
    } catch {
      await Bun.sleep(250)
    }
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(timeoutMessage))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
  }
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

function createOpenCodeSessionConfig(baseConfig: Config, model: string): Config {
  return {
    ...baseConfig,
    model: `${OPENCODE_MODEL_PROVIDER_ID}/${model}`,
  }
}

function setOpenCodeEnvironment({
  providerBaseUrl,
  apiKey,
}: {
  providerBaseUrl: string
  apiKey: string
}): () => void {
  const previousEndpoint = process.env[RESIDE_LLM_ENDPOINT_ENV_VAR]
  const previousApiKey = process.env[RESIDE_LLM_API_KEY_ENV_VAR]
  process.env[RESIDE_LLM_ENDPOINT_ENV_VAR] = providerBaseUrl
  process.env[RESIDE_LLM_API_KEY_ENV_VAR] = apiKey

  return () => {
    restoreEnvironmentValue(RESIDE_LLM_ENDPOINT_ENV_VAR, previousEndpoint)
    restoreEnvironmentValue(RESIDE_LLM_API_KEY_ENV_VAR, previousApiKey)
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

function normalizeAgentResponse(response: SessionPromptResponse): string {
  return response.parts
    .filter(part => part.type === "text")
    .map(part => part.text)
    .join("\n")
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
