import type { ReplicaProfile } from "@reside/shared"
import type { Logger } from "pino"
import type { AppConfig } from "./config"
import {
  type GitHubData,
  getOrCreateRepository,
  getRepositoryByOwnerAndName,
  type Repository,
} from "@contracts/github.v1"
import { JazzRequestError } from "jazz-tools"
import { App, type Octokit } from "octokit"
import { syncIssueEntity } from "./issue"
import { syncPullRequestEntity } from "./pull-request"

export class GitHubService {
  readonly app: App

  constructor(
    githubData: GitHubData,
    appConfig: AppConfig,
    private readonly logger: Logger,
  ) {
    this.app = new App({
      appId: appConfig.appId,
      privateKey: appConfig.privateKey,
      webhooks: { secret: appConfig.webhookSecret },
    })

    const getRepository = async (
      repositorySpec?:
        | {
            owner: { name?: string | null }
            name: string
          }
        | { full_name?: string },
    ): Promise<Repository> => {
      if (!repositorySpec) {
        throw new JazzRequestError("Repository information is missing.", 400)
      }

      let owner: string | undefined
      let name: string | undefined

      if ("full_name" in repositorySpec) {
        const parts = repositorySpec.full_name?.split("/")
        if (!parts || parts.length !== 2) {
          throw new JazzRequestError("Invalid repository full name.", 400)
        }
        owner = parts[0]
        name = parts[1]
      } else if ("owner" in repositorySpec) {
        owner = repositorySpec.owner.name!
        name = repositorySpec.name
      }

      if (!owner) {
        throw new JazzRequestError("Repository owner information is missing.", 400)
      }

      if (!name) {
        throw new JazzRequestError("Repository name information is missing.", 400)
      }

      const repository = await getRepositoryByOwnerAndName(githubData, owner, name)
      if (!repository) {
        throw new JazzRequestError(`Repository ${owner}/${name} not found.`, 404)
      }

      return repository
    }

    this.app.webhooks.on(["issues.opened", "issues.edited", "issues.closed"], async event => {
      const repository = await getRepository(event.payload.repository)

      await syncIssueEntity(
        githubData,
        repository,
        event.payload.issue.id,
        event.payload.issue.state === "open"
          ? "open"
          : event.payload.issue.state_reason === "completed"
            ? "completed"
            : "closed",
        event.payload.issue.title,
        event.payload.issue.body || "",
      )
    })

    this.app.webhooks.on(
      ["pull_request.opened", "pull_request.edited", "pull_request.closed"],
      async event => {
        const repository = await getRepository(event.payload.repository)

        await syncPullRequestEntity(
          githubData,
          repository,
          event.payload.pull_request.id,
          event.payload.pull_request.state === "open"
            ? "open"
            : event.payload.pull_request.merged
              ? "merged"
              : "closed",
          event.payload.pull_request.title,
          event.payload.pull_request.body || "",
        )
      },
    )

    this.app.webhooks.on("installation.created", async event => {
      this.logger.info(`GitHub App installed on installation ID %d`, event.payload.installation.id)

      const repoInfo = event.payload.repositories?.[0]
      if (!repoInfo) {
        this.logger.warn("No repositories found in installation.created event payload")
        return
      }

      const [owner, name] = repoInfo.full_name.split("/")
      if (!owner || !name) {
        this.logger.warn(
          "Invalid repository full name in installation.created event payload: %s",
          repoInfo.full_name,
        )
        return
      }

      const repository = await getOrCreateRepository(githubData, owner, name)

      if (repository.status !== "connected") {
        repository.$jazz.set("status", "connected")
      }

      repository.$jazz.set("installationId", event.payload.installation.id)
    })

    this.app.webhooks.on("installation.deleted", async event => {
      this.logger.info(
        `GitHub App uninstalled from installation ID %d`,
        event.payload.installation.id,
      )

      const repository = await getRepository(event.payload.repositories?.[0])

      if (repository.status !== "lost-connection") {
        repository.$jazz.set("status", "lost-connection")
      }

      repository.$jazz.set("installationId", undefined)
    })
  }

  async ensureWebhookConfigured(profile: ReplicaProfile<Record<string, never>>): Promise<void> {
    const external = profile.endpoints?.external
    if (!external) {
      throw new Error("Cannot configure webhook: external endpoint is not set up for the profile.")
    }

    const webhookUrl = `${external}/replicas/${profile.name}/webhook`
    const webhookConfig = await this.app.octokit.rest.apps.getWebhookConfigForApp({})

    if (webhookConfig.data.url === webhookUrl) {
      this.logger.info(
        `GitHub webhook is already configured with URL "%s" for replica "%s"`,
        webhookUrl,
        profile.name,
      )
      return
    }

    this.logger.info(
      `Configuring GitHub webhook with URL "%s" for replica "%s"`,
      webhookUrl,
      profile.name,
    )

    await this.app.octokit.rest.apps.updateWebhookConfigForApp({ data: { url: webhookUrl } })
  }

  async getOctokit(repository: Repository): Promise<Octokit> {
    if (!repository.installationId) {
      throw new Error("Repository is not connected.")
    }

    return await this.app.getInstallationOctokit(repository.installationId)
  }

  async handleWebhookEvent(request: Bun.BunRequest): Promise<void> {
    const signature = request.headers.get("x-hub-signature-256")
    if (!signature) {
      throw new JazzRequestError("Missing X-Hub-Signature-256 header.", 400)
    }

    const id = request.headers.get("x-github-delivery")
    if (!id) {
      throw new JazzRequestError("Missing X-GitHub-Delivery header.", 400)
    }

    const name = request.headers.get("x-github-event")
    if (!name) {
      throw new JazzRequestError("Missing X-GitHub-Event header.", 400)
    }

    this.logger.info(`received github event of type "%s" with delivery id "%s"`, name, id)

    try {
      const body = await request.text()

      await this.app.webhooks.verifyAndReceive({ id, name, payload: body, signature })
    } catch (err) {
      this.logger.error({ err }, "failed to process github webhook event")

      throw err
    }
  }
}
