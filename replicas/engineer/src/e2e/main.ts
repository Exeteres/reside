import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CopilotClient } from "@github/copilot-sdk"
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
let copilotClient: CopilotClient | undefined

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

  copilotClient = new CopilotClient({
    useLoggedInUser: false,
  })

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

  const session = await copilotClient.createSession({
    model: llmSecret["light-model"],
    provider: {
      type: "openai",
      baseUrl: llmSecret.endpoint,
      apiKey: llmSecret["api-key"],
    },
    workingDirectory: repositoryPath,
    onPermissionRequest: async () => ({ kind: "approved" }),
  })

  try {
    const agentResponse = await session.sendAndWait({
      prompt: "Say hello to engineer replica in one short sentence.",
    })

    logger.info('engineer e2e agent response text="%s"', normalizeAgentResponse(agentResponse))
  } finally {
    await session.disconnect()
  }

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
    if (copilotClient) {
      await copilotClient.stop()
    }

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

function normalizeAgentResponse(response: unknown): string {
  if (typeof response === "string") {
    return response
  }

  if (response && typeof response === "object") {
    const objectResponse = response as {
      text?: unknown
      content?: unknown
      message?: unknown
    }

    for (const value of [objectResponse.text, objectResponse.content, objectResponse.message]) {
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
