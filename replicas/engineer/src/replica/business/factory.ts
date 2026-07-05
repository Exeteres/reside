import type { GitHubService } from "./github"
import { join } from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { logger } from "@reside/common"
import {
  ENGINEER_FACTORY_INTERNAL_ENDPOINT,
  ENGINEER_FACTORY_PASSWORD_SECRET_KEY,
  ENGINEER_FACTORY_PASSWORD_SECRET_NAME,
  FACTORY_HOME_DIR,
  FACTORY_REPOSITORY_DIR,
  FACTORY_ROOT_DIR,
} from "../../definitions"

export type FactoryEnvironment = {
  workingDirectory: string
  repositoryPath: string
  opencodeSessionId: string
  taskId: number
  branchName: string
  dispose: () => Promise<void>
}

export async function createFactoryEnvironment({
  github,
  taskId,
  iterationId,
}: {
  github: GitHubService
  taskId: number
  iterationId: number
}): Promise<FactoryEnvironment> {
  await github.getRepositoryTarget()
  const factoryRootPath = getFactoryRootPath()
  const mainRepositoryPath = join(factoryRootPath, FACTORY_REPOSITORY_DIR)
  const branchName = `replica/task-${taskId}/${iterationId}`
  const worktreeName = branchName.replaceAll("/", "-")

  logger.info(
    'engineer factory environment creation started task_id="%s" iteration_id="%s" branch="%s"',
    String(taskId),
    String(iterationId),
    branchName,
  )

  const worktree = await createFactoryWorktree({
    mainRepositoryPath,
    name: worktreeName,
  })
  const worktreePath = worktree.directory
  const session = await createFactorySession({
    worktreePath,
    sessionId: `reside-task-${taskId}-${iterationId}`,
  })

  logger.info(
    'engineer factory environment creation completed task_id="%s" iteration_id="%s" branch="%s" directory="%s" session_id="%s"',
    String(taskId),
    String(iterationId),
    branchName,
    worktreePath,
    session.id,
  )

  return {
    workingDirectory: worktreePath,
    repositoryPath: worktreePath,
    opencodeSessionId: session.id,
    taskId,
    branchName,
    dispose: async () => undefined,
  }
}

export function getFactoryRootPath(): string {
  return join(FACTORY_HOME_DIR, FACTORY_ROOT_DIR)
}

async function createFactoryWorktree({
  mainRepositoryPath,
  name,
}: {
  mainRepositoryPath: string
  name: string
}): Promise<{ directory: string }> {
  const opencode = createOpencodeClient({
    baseUrl: ENGINEER_FACTORY_INTERNAL_ENDPOINT,
    directory: mainRepositoryPath,
    fetch: createAuthenticatedOpenCodeFetch(await getFactoryPassword()),
  })
  const existing = await opencode.worktree.list({
    directory: mainRepositoryPath,
  })
  if (existing.error) {
    throw new Error(
      `Failed to list OpenCode factory worktrees: ${formatOpenCodeError(existing.error)}`,
    )
  }

  const existingWorktree = existing.data.find(directory => directory.includes(name))
  if (existingWorktree) {
    logger.info('engineer factory worktree reused name="%s" directory="%s"', name, existingWorktree)

    return {
      directory: existingWorktree,
    }
  }

  const created = await opencode.worktree.create({
    directory: mainRepositoryPath,
    worktreeCreateInput: {
      name,
    },
  })
  if (created.error) {
    throw new Error(
      `Failed to create OpenCode factory worktree: ${formatOpenCodeError(created.error)}`,
    )
  }

  logger.info(
    'engineer factory worktree created name="%s" directory="%s"',
    created.data.name,
    created.data.directory,
  )

  return {
    directory: created.data.directory,
  }
}

async function createFactorySession({
  worktreePath,
  sessionId,
}: {
  worktreePath: string
  sessionId: string
}): Promise<{ id: string }> {
  const opencode = createOpencodeClient({
    baseUrl: ENGINEER_FACTORY_INTERNAL_ENDPOINT,
    directory: worktreePath,
    fetch: createAuthenticatedOpenCodeFetch(await getFactoryPassword()),
  })
  const created = await opencode.session.create({
    directory: worktreePath,
    title: sessionId,
    agent: "build",
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  })
  if (created.error) {
    throw new Error(
      `Failed to create OpenCode factory session: ${formatOpenCodeError(created.error)}`,
    )
  }

  logger.info(
    'engineer factory session created session_id="%s" directory="%s"',
    created.data.id,
    worktreePath,
  )

  return {
    id: created.data.id,
  }
}

export function createEnvironmentPrompt(skillName: string, message: string): string {
  return `Before working with the user's request, load the "${skillName}" skill.\n${message}`
}

function formatOpenCodeError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message)
  }

  return JSON.stringify(error)
}

function createAuthenticatedOpenCodeFetch(password: string): typeof fetch {
  const authorization = `Basic ${Buffer.from(`opencode:${password}`, "utf8").toString("base64")}`

  return Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const headers = new Headers(init?.headers)
      headers.set("authorization", authorization)

      return await fetch(input, {
        ...init,
        headers,
      })
    },
    { preconnect: fetch.preconnect },
  )
}

async function getFactoryPassword(): Promise<string> {
  const process = Bun.spawn(
    [
      "kubectl",
      "get",
      "secret",
      ENGINEER_FACTORY_PASSWORD_SECRET_NAME,
      "-o",
      `jsonpath={.data.${ENGINEER_FACTORY_PASSWORD_SECRET_KEY}}`,
    ],
    {
      stdout: "pipe",
      stderr: "inherit",
    },
  )
  const encodedPassword = await new Response(process.stdout).text()

  if ((await process.exited) !== 0) {
    throw new Error("Failed to read OpenCode factory password")
  }

  return Buffer.from(encodedPassword, "base64").toString("utf8")
}
