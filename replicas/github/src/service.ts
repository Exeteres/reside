import type { GitHubData, Repository } from "@contracts/github.v1"
import type { Logger } from "pino"
import type { AppConfig } from "./config"
import { JazzRequestError } from "jazz-tools"
import { App, type Octokit } from "octokit"
import { syncIssueEntity } from "./issue"
import { syncPullRequestEntity } from "./pull-request"
import { getRepositoryByInstallationId } from "./repository"

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

    const getRepository = async (installation?: { id: number }) => {
      if (!installation?.id) {
        throw new Error("Missing installation ID in webhook payload.")
      }

      const repository = await getRepositoryByInstallationId(githubData, installation.id)
      if (!repository) {
        throw new JazzRequestError("Repository not found for the given installation ID.", 404)
      }

      return repository
    }

    this.app.webhooks.on(["issues.opened", "issues.edited"], async event => {
      const repository = await getRepository(event.payload.installation)

      await syncIssueEntity(
        githubData,
        repository,
        event.payload.issue.id,
        event.payload.issue.title,
        event.payload.issue.body || "",
      )
    })

    this.app.webhooks.on(["pull_request.opened", "pull_request.edited"], async event => {
      const repository = await getRepository(event.payload.installation)

      await syncPullRequestEntity(
        githubData,
        repository,
        event.payload.pull_request.id,
        event.payload.pull_request.title,
        event.payload.pull_request.body || "",
      )
    })
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
