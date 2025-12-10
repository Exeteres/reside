import { getRepositoryById } from "@contracts/github.v1"
import { TelegramRealm } from "@contracts/telegram.v1"
import { startReplica } from "@reside/shared/node"
import { JazzRequestError } from "jazz-tools"
import { createComposer } from "./composer"
import { config } from "./config"
import { handler } from "./handler"
import { syncIssueEntity } from "./issue"
import { GithubReplica } from "./replica"
import { GitHubService } from "./service"

const {
  account,
  replicaName,
  implementations: { github, telegramHandler },
  requirements: { secret, telegram, userManager },
  registerRoutes,
  logger,
} = await startReplica(GithubReplica)

let service: GitHubService | undefined

const composer = createComposer(account.$jazz.id, () => service, logger)

await config.init(secret.data, replicaName, logger)
await handler.init(telegram, telegramHandler, replicaName, composer, logger)
await TelegramRealm.init(userManager, logger)

const loadedAccount = await account.$jazz.ensureLoaded({ resolve: { profile: true } })

const configBox = await config.getBox()

configBox.$jazz.subscribe(async ({ value }) => {
  if (!value.app) {
    logger.warn("GitHub app configuration is missing")
    service = undefined
    return
  }

  service = new GitHubService(github.data, value.app, logger)
  logger.info("GitHub service configured successfully")

  await service.ensureWebhookConfigured(loadedAccount.profile)
})

github.handleConnectRepository(async (_, account) => {
  if (!github.checkPermission(account, "repository:connect")) {
    throw new JazzRequestError("You do not have permission to connect repositories.", 403)
  }

  if (!service) {
    throw new JazzRequestError("GitHub service is not configured.", 500)
  }

  const connectionUrl = await service.app.getInstallationUrl()

  return { connectionUrl }
})

github.handleCreateIssue(async (request, account) => {
  const repository = await getRepositoryById(github.data, request.repositoryId)
  if (!repository) {
    throw new JazzRequestError("Repository not found.", 404)
  }

  if (
    !github.checkPermission(
      account,
      "issue:read:repository",
      `${repository.owner}.${repository.name}`,
    )
  ) {
    throw new JazzRequestError(
      "You do not have permission to create issues in this repository.",
      403,
    )
  }

  if (!service) {
    throw new JazzRequestError("GitHub service is not configured.", 500)
  }

  const octokit = await service.getOctokit(repository)

  const response = await octokit.rest.issues.create({
    owner: repository.owner,
    repo: repository.name,
    title: request.title,
    body: request.body,
  })

  const issue = await syncIssueEntity(
    github.data,
    repository,
    response.data.id,
    "open",
    response.data.title,
    response.data.body ?? undefined,
  )

  return { issue }
})

registerRoutes({
  webhook: {
    POST: async req => {
      if (!service) {
        throw new JazzRequestError("GitHub service is not configured.", 500)
      }

      try {
        await service.handleWebhookEvent(req)
      } catch (err) {
        if (err instanceof JazzRequestError) {
          return new Response(err.message, { status: err.code })
        }

        return new Response("Internal server error.", { status: 500 })
      }

      return new Response(null, { status: 200 })
    },
  },
})
