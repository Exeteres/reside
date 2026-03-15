import { logger } from "@reside/common"
import { startEngineerAiRuntime } from "../replica"

const runtime = await startEngineerAiRuntime()
let exitCode = 0

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

  const copilotClient = await withTimeout(
    waitForReadyValue(() => runtime.getCopilotClient()),
    30_000,
    'Timed out waiting for secret "copilot" to initialize copilot client',
  )

  const issuesResponse = await octokit.rest.issues.listForRepo({
    owner: repository.owner,
    repo: repository.name,
    per_page: 2,
    state: "all",
  })

  logger.info(
    {
      owner: repository.owner,
      repo: repository.name,
      issues: issuesResponse.data.map(issue => ({
        number: issue.number,
        state: issue.state,
        title: issue.title,
        url: issue.html_url,
      })),
    },
    "engineer e2e repository issues",
  )

  const session = await copilotClient.createSession({
    model: "gpt-5-mini",
    workingDirectory: repository.localPath,
    onPermissionRequest: async () => ({ kind: "approved" }),
  })

  try {
    const agentResponse = await session.sendAndWait({
      prompt: "Say hello to engineer replica in one short sentence.",
    })

    logger.info(
      {
        response: normalizeAgentResponse(agentResponse),
      },
      "engineer e2e agent response",
    )
  } finally {
    await session.disconnect()
  }

  logger.info("engineer e2e completed")
} catch (error) {
  exitCode = 1

  logger.error(
    {
      error: error instanceof Error ? error.message : String(error),
    },
    "engineer e2e failed",
  )
} finally {
  try {
    await withTimeout(runtime.stop(), 5_000, "Timed out waiting for runtime stop")
  } catch (error) {
    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "engineer e2e runtime stop warning",
    )
  }

  await Bun.sleep(50)
  process.exit(exitCode)
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
