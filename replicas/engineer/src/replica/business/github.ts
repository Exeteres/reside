import { webcrypto } from "node:crypto"
import { createAppAuth } from "@octokit/auth-app"
import { logger, subscribeToConfigMap, subscribeToSecret } from "@reside/common"
import { toError } from "@reside/utils"
import { Octokit } from "octokit"
import { z } from "zod"

const githubAppSecretSchema = z.object({
  app_id: z.string().min(1),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  private_key: z.string().min(1),
  installation_id: z.string().min(1),
})

const githubRepositoryConfigSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
})

export type GithubRepositoryTarget = {
  owner: string
  name: string
  cloneUrl: string
}

export type GitHubService = {
  getOctokit: () => Promise<Octokit>
  getRepositoryTarget: () => Promise<GithubRepositoryTarget>
  stop: () => Promise<void>
}

export async function startGitHubService(): Promise<GitHubService> {
  ensureWebCryptoGlobals()

  let currentOctokit: Octokit | undefined
  let currentRepositoryTarget: GithubRepositoryTarget | undefined
  let rejectOctokitPromise: ((reason?: unknown) => void) | undefined
  let resolveOctokitPromise: ((value: Octokit) => void) | undefined
  let resolveRepositoryTargetPromise: ((value: GithubRepositoryTarget) => void) | undefined

  const stopRepositorySubscription = startSubscription(
    subscribeToConfigMap("github-repository"),
    async configMap => {
      try {
        const parsed = githubRepositoryConfigSchema.parse(configMap)

        currentRepositoryTarget = {
          owner: parsed.owner,
          name: parsed.name,
          cloneUrl: `https://github.com/${parsed.owner}/${parsed.name}.git`,
        }

        if (resolveRepositoryTargetPromise) {
          resolveRepositoryTargetPromise(currentRepositoryTarget)
          resolveRepositoryTargetPromise = undefined
        }

        logger.info(
          'engineer github repository target updated owner="%s" name="%s" clone_url="%s"',
          currentRepositoryTarget.owner,
          currentRepositoryTarget.name,
          currentRepositoryTarget.cloneUrl,
        )
      } catch (error) {
        logger.error({ error: toError(error) }, "failed to configure engineer repository target")
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
        if (resolveOctokitPromise) {
          resolveOctokitPromise(octokit)
          resolveOctokitPromise = undefined
          rejectOctokitPromise = undefined
        }
        const appSlug = app.data?.slug ?? "unknown"

        logger.info('engineer github app client updated slug="%s"', appSlug)
      } catch (error) {
        const errorValue = toError(error)
        if (rejectOctokitPromise) {
          rejectOctokitPromise(errorValue)
          resolveOctokitPromise = undefined
          rejectOctokitPromise = undefined
        }

        logger.error({ error: errorValue }, "failed to configure engineer github app client")
      }
    },
  )

  const repositoryTargetPromise = new Promise<GithubRepositoryTarget>(resolve => {
    resolveRepositoryTargetPromise = resolve
  })
  const octokitPromise = new Promise<Octokit>((resolve, reject) => {
    resolveOctokitPromise = resolve
    rejectOctokitPromise = reject
  })

  return {
    getOctokit: async () => {
      if (currentOctokit) {
        return currentOctokit
      }

      return await octokitPromise
    },

    getRepositoryTarget: async () => {
      if (currentRepositoryTarget) {
        return currentRepositoryTarget
      }

      return await repositoryTargetPromise
    },

    stop: async () => {
      await Promise.allSettled([stopRepositorySubscription(), stopGithubAppSubscription()])
    },
  }
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
    logger.error({ error: toError(error) }, "engineer subscription loop failed")
  })

  return async () => {
    isStopped = true

    try {
      void iterator.return?.()
    } catch {
      // no-op
    }

    await _loop
  }
}
