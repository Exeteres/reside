import type { Config, SessionPromptResponse } from "@opencode-ai/sdk/v2"
import { mkdtemp, rm } from "node:fs/promises"
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

  const opencode = await createOpencode({
    port: 0,
    config: createOpenCodeConfig(llmSecret),
  })
  const session = await opencode.client.session.create({
    directory: repositoryPath,
    title: "Engineer e2e",
    agent: "build",
    model: {
      id: llmSecret["light-model"],
      providerID: "reside",
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
      providerID: "reside",
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

function createOpenCodeConfig(llmSecret: z.infer<typeof llmSecretSchema>): Config {
  return {
    share: "disabled",
    autoupdate: false,
    provider: {
      reside: {
        name: "ReSide LLM",
        api: "openai",
        options: {
          apiKey: llmSecret["api-key"],
          baseURL: llmSecret.endpoint,
        },
        models: {
          [llmSecret["light-model"]]: {
            name: llmSecret["light-model"],
            tool_call: true,
            reasoning: true,
          },
        },
      },
    },
  }
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
