import { webcrypto } from "node:crypto"
import { mkdir, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { CopilotClient } from "@github/copilot-sdk"
import { createAppAuth } from "@octokit/auth-app"
import { logger, subscribeToConfigMap, subscribeToSecret } from "@reside/common"
import { Octokit } from "octokit"
import { z } from "zod"

const githubAppSecretSchema = z.object({
  app_id: z.string().min(1),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  private_key: z.string().min(1),
  installation_id: z.string().min(1),
})

const copilotSecretSchema = z.object({
  user_token: z.string().min(1),
})

const githubRepositoryConfigSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
})

type GithubRepositoryTarget = {
  owner: string
  name: string
  localPath: string
}

const LOCAL_REPOSITORY_ROOT = "/tmp/engineer/repositories"

export type EngineerAiRuntime = {
  getOctokit: () => Octokit
  getCopilotClient: () => CopilotClient
  getRepositoryTarget: () => Promise<GithubRepositoryTarget>
  stop: () => Promise<void>
}

export async function startEngineerAiRuntime(): Promise<EngineerAiRuntime> {
  ensureWebCryptoGlobals()

  let currentOctokit: Octokit | undefined
  let currentCopilotClient: CopilotClient | undefined
  let currentRepositoryTarget: GithubRepositoryTarget | undefined
  let lastOctokitError: string | undefined
  let lastCopilotError: string | undefined
  let resolveRepositoryTargetPromise: ((value: GithubRepositoryTarget) => void) | undefined

  const stopRepositorySubscription = startSubscription(
    subscribeToConfigMap("github-repository"),
    async configMap => {
      try {
        const parsed = githubRepositoryConfigSchema.parse(configMap)
        const localPath = await ensureReadonlyRepositoryClone(parsed.owner, parsed.name)

        currentRepositoryTarget = {
          owner: parsed.owner,
          name: parsed.name,
          localPath,
        }

        if (resolveRepositoryTargetPromise) {
          resolveRepositoryTargetPromise(currentRepositoryTarget)
          resolveRepositoryTargetPromise = undefined
        }

        logger.info(currentRepositoryTarget, "engineer github repository target updated")
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
          },
          "failed to configure engineer repository target",
        )
      }
    },
  )

  const stopGithubAppSubscription = startSubscription(
    subscribeToSecret("github-app"),
    async secret => {
      try {
        const parsed = githubAppSecretSchema.parse(secret)

        const octokit = new Octokit({
          authStrategy: createAppAuth,
          auth: {
            appId: parsed.app_id,
            privateKey: parsed.private_key,
            clientId: parsed.client_id,
            clientSecret: parsed.client_secret,
            installationId: parsed.installation_id,
          },
        })

        const app = await octokit.rest.apps.getAuthenticated()
        currentOctokit = octokit
        lastOctokitError = undefined
        const appSlug = app.data?.slug ?? "unknown"

        logger.info({ slug: appSlug }, "engineer github app client updated")
      } catch (error) {
        lastOctokitError = error instanceof Error ? error.message : String(error)

        logger.error(
          {
            error: lastOctokitError,
          },
          "failed to configure engineer github app client",
        )
      }
    },
  )

  const stopCopilotSubscription = startSubscription(subscribeToSecret("copilot"), async secret => {
    try {
      const parsed = copilotSecretSchema.parse(secret)

      if (currentCopilotClient) {
        await currentCopilotClient.stop()
      }

      const client = new CopilotClient({
        githubToken: parsed.user_token,
        useLoggedInUser: false,
      })

      await client.start()

      const authStatus = await client.getAuthStatus()
      currentCopilotClient = client
      lastCopilotError = undefined

      logger.info(
        {
          isAuthenticated: authStatus.isAuthenticated,
          authType: authStatus.authType,
          login: authStatus.login,
        },
        "engineer copilot client updated",
      )
    } catch (error) {
      lastCopilotError = error instanceof Error ? error.message : String(error)

      logger.error(
        {
          error: lastCopilotError,
        },
        "failed to configure engineer copilot client",
      )
    }
  })

  const repositoryTargetPromise = new Promise<GithubRepositoryTarget>(resolve => {
    resolveRepositoryTargetPromise = resolve
  })

  return {
    getOctokit: () => {
      if (!currentOctokit) {
        const reason = lastOctokitError ? ` Last error: ${lastOctokitError}` : ""
        throw new Error(
          `GitHub App client is not ready: secret "github-app" is not configured.${reason}`,
        )
      }

      return currentOctokit
    },

    getCopilotClient: () => {
      if (!currentCopilotClient) {
        const reason = lastCopilotError ? ` Last error: ${lastCopilotError}` : ""
        throw new Error(`Copilot client is not ready: secret "copilot" is not configured.${reason}`)
      }

      return currentCopilotClient
    },

    getRepositoryTarget: async () => {
      if (currentRepositoryTarget) {
        return currentRepositoryTarget
      }

      return await repositoryTargetPromise
    },

    stop: async () => {
      await Promise.allSettled([
        stopRepositorySubscription(),
        stopGithubAppSubscription(),
        stopCopilotSubscription(),
      ])

      if (currentCopilotClient) {
        await currentCopilotClient.stop()
      }
    },
  }
}

async function ensureReadonlyRepositoryClone(owner: string, name: string): Promise<string> {
  const localPath = join(LOCAL_REPOSITORY_ROOT, owner, name)

  if (await pathExists(localPath)) {
    return localPath
  }

  await mkdir(dirname(localPath), { recursive: true })

  const cloneUrl = `https://github.com/${owner}/${name}.git`
  await runCommand(["git", "clone", "--depth", "1", cloneUrl, localPath])
  await runCommand(["chmod", "-R", "a-w", localPath])

  return localPath
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
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

function ensureWebCryptoGlobals(): void {
  const root = globalThis as typeof globalThis & {
    subtle?: SubtleCrypto
  }

  if (!root.subtle) {
    root.subtle = webcrypto.subtle
  }
}

function startSubscription<T>(
  iterable: AsyncIterable<T>,
  onValue: (value: T) => Promise<void>,
): () => Promise<void> {
  const iterator = iterable[Symbol.asyncIterator]()
  let isStopped = false

  const _loop = (async () => {
    while (!isStopped) {
      const next = await iterator.next()
      if (next.done || isStopped) {
        break
      }

      await onValue(next.value)
    }
  })().catch(error => {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "engineer subscription loop failed",
    )
  })

  return async () => {
    isStopped = true

    try {
      void iterator.return?.()
    } catch {
      // no-op
    }
  }
}
