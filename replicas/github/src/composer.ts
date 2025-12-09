import type { Logger } from "pino"
import {
  GitHubContract,
  getRepositoryById,
  type Issue,
  type PullRequest,
  type Repository,
} from "@contracts/github.v1"
import { type ResideTelegramContext, TelegramRealm } from "@contracts/telegram.v1"
import { createRequirement } from "@reside/shared"
import { Composer, InlineKeyboard } from "grammy"
import { renderIssue, renderIssueList, renderIssueListKeyboard } from "./issue-ui"
import {
  renderPullRequest,
  renderPullRequestList,
  renderPullRequestListKeyboard,
} from "./pull-request-ui"

type RepositoryPermissionKey = "issue:read:repository" | "pull-request:read:repository"

type RepositorySummary = {
  id: number
  owner: string
  name: string
}

export function createComposer(
  githubReplicaAccountId: string,
  logger: Logger,
): Composer<ResideTelegramContext> {
  const composer = new Composer<ResideTelegramContext>()

  logger.debug("github composer initialized")
  const loadRepository = async (repositoryId: number): Promise<Repository | null> => {
    const requirement = await createRequirement(GitHubContract, githubReplicaAccountId)
    return await getRepositoryById(requirement.data, repositoryId)
  }

  const getRepositoryInstanceId = (repository: Repository): string => {
    return `${repository.owner}.${repository.name}`
  }

  const collectAccessibleRepositories = async (
    ctx: ResideTelegramContext,
    permissionKey: RepositoryPermissionKey,
  ): Promise<RepositorySummary[]> => {
    const loadedUser = await ctx.user!.$jazz.ensureLoaded({ resolve: { user: true } })
    const repositories: RepositorySummary[] = []

    await TelegramRealm.impersonate(loadedUser.user, async account => {
      const requirement = await createRequirement(GitHubContract, githubReplicaAccountId, account)
      const instances = await requirement.getPermissionInstances(permissionKey)

      if (Object.keys(instances).length === 0) {
        return
      }

      const loadedData = await requirement.data.$jazz.ensureLoaded({
        resolve: {
          repositories: {
            $each: true,
          },
        },
      })

      for (const repository of loadedData.repositories.values()) {
        const instanceId = getRepositoryInstanceId(repository)
        if (!(instanceId in instances)) {
          continue
        }

        repositories.push({
          id: repository.id,
          owner: repository.owner,
          name: repository.name,
        })
      }
    })

    repositories.sort((a, b) => {
      const ownerComparison = a.owner.localeCompare(b.owner)
      if (ownerComparison !== 0) {
        return ownerComparison
      }

      return a.name.localeCompare(b.name)
    })

    return repositories
  }

  const buildRepositoryKeyboard = (
    repositories: RepositorySummary[],
    action: "issues" | "pull-requests",
  ): InlineKeyboard => {
    const keyboard = new InlineKeyboard()

    for (const repository of repositories) {
      const label = `${repository.owner}/${repository.name}`
      const callbackPrefix =
        action === "issues" ? "github:issues:list" : "github:pull-requests:list"

      keyboard.text(label, `${callbackPrefix}:${repository.id}`).row()
    }

    return keyboard
  }

  const showRepositorySelection = async (
    ctx: ResideTelegramContext,
    permissionKey: RepositoryPermissionKey,
    action: "issues" | "pull-requests",
    makeMessage: (count: number) => string,
    respond: (message: string, keyboard: InlineKeyboard) => Promise<unknown>,
  ): Promise<void> => {
    const repositories = await collectAccessibleRepositories(ctx, permissionKey)

    if (repositories.length === 0) {
      await respond("Доступных репозиториев не найдено.", new InlineKeyboard())
      return
    }

    const keyboard = buildRepositoryKeyboard(repositories, action)
    await respond(makeMessage(repositories.length), keyboard)
  }

  const withRepositoryAccess = async (
    ctx: ResideTelegramContext,
    repository: Repository,
    permissionKey: RepositoryPermissionKey,
    onDenied: () => Promise<void>,
    onGranted: () => Promise<void>,
  ): Promise<void> => {
    const loadedUser = await ctx.user!.$jazz.ensureLoaded({ resolve: { user: true } })
    let allowed = false

    await TelegramRealm.impersonate(loadedUser.user, async account => {
      const requirement = await createRequirement(GitHubContract, githubReplicaAccountId, account)
      allowed = await requirement.checkPermission(
        permissionKey,
        getRepositoryInstanceId(repository),
      )
    })

    if (!allowed) {
      await onDenied()
      return
    }

    await onGranted()
  }

  composer.command("issues", async ctx => {
    await showRepositorySelection(
      ctx,
      "issue:read:repository",
      "issues",
      count => `📁 Выберите репозиторий для просмотра задач (${count}).`,
      async (message, keyboard) => {
        return await ctx.reply(message, { reply_markup: keyboard })
      },
    )
  })

  composer.callbackQuery(/^github:issues:list:(\d+)$/, async ctx => {
    const repositoryId = Number(ctx.match[1])
    const repository = await loadRepository(repositoryId)

    if (!repository) {
      await ctx.answerCallbackQuery({ text: "Репозиторий не найден!", show_alert: true })
      return
    }

    await withRepositoryAccess(
      ctx,
      repository,
      "issue:read:repository",
      async () => {
        await ctx.answerCallbackQuery({ text: "Доступ к задачам запрещен!", show_alert: true })
      },
      async () => {
        const [message, keyboard] = await Promise.all([
          renderIssueList(repository),
          (async () => {
            const repoKeyboard = await renderIssueListKeyboard(repository)
            repoKeyboard.text("⬅️ К репозиториям", "github:issues:repos").row()
            return repoKeyboard
          })(),
        ])

        await ctx.editMessageText(message.value, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        })

        await ctx.answerCallbackQuery()
      },
    )
  })

  composer.callbackQuery(/^github:issue:(\d+):(\d+)$/, async ctx => {
    const repositoryId = Number(ctx.match[1])
    const issueId = Number(ctx.match[2])
    const repository = await loadRepository(repositoryId)

    if (!repository) {
      await ctx.answerCallbackQuery({ text: "Репозиторий не найден!", show_alert: true })
      return
    }

    const loadedRepository = await repository.$jazz.ensureLoaded({ resolve: { issues: true } })
    const issues = Array.from(loadedRepository.issues.values()) as Issue[]
    const issue = issues.find(current => current.id === issueId)

    if (!issue) {
      await ctx.answerCallbackQuery({ text: "Задача не найдена!", show_alert: true })
      return
    }

    await withRepositoryAccess(
      ctx,
      repository,
      "issue:read:repository",
      async () => {
        await ctx.answerCallbackQuery({ text: "Доступ к задачам запрещен!", show_alert: true })
      },
      async () => {
        const [message, keyboard] = await Promise.all([
          renderIssue(issue, repository),
          renderIssueListKeyboard(repository),
        ])

        keyboard.text("⬅️ К списку", `github:issues:list:${repositoryId}`).row()
        keyboard.text("⬅️ К репозиториям", "github:issues:repos").row()

        await ctx.editMessageText(message.value, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        })

        await ctx.answerCallbackQuery()
      },
    )
  })

  composer.command("pull_requests", async ctx => {
    await showRepositorySelection(
      ctx,
      "pull-request:read:repository",
      "pull-requests",
      count => `📁 Выберите репозиторий для просмотра pull request'ов (${count}).`,
      async (message, keyboard) => {
        return await ctx.reply(message, { reply_markup: keyboard })
      },
    )
  })

  composer.callbackQuery(/^github:pull-requests:list:(\d+)$/, async ctx => {
    const repositoryId = Number(ctx.match[1])
    const repository = await loadRepository(repositoryId)

    if (!repository) {
      await ctx.answerCallbackQuery({ text: "Репозиторий не найден!", show_alert: true })
      return
    }

    await withRepositoryAccess(
      ctx,
      repository,
      "pull-request:read:repository",
      async () => {
        await ctx.answerCallbackQuery({
          text: "Доступ к pull request'ам запрещен!",
          show_alert: true,
        })
      },
      async () => {
        const [message, keyboard] = await Promise.all([
          renderPullRequestList(repository),
          (async () => {
            const repoKeyboard = await renderPullRequestListKeyboard(repository)
            repoKeyboard.text("⬅️ К репозиториям", "github:pull-requests:repos").row()
            return repoKeyboard
          })(),
        ])

        await ctx.editMessageText(message.value, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        })

        await ctx.answerCallbackQuery()
      },
    )
  })

  composer.callbackQuery(/^github:pull-request:(\d+):(\d+)$/, async ctx => {
    const repositoryId = Number(ctx.match[1])
    const pullRequestId = Number(ctx.match[2])
    const repository = await loadRepository(repositoryId)

    if (!repository) {
      await ctx.answerCallbackQuery({ text: "Репозиторий не найден!", show_alert: true })
      return
    }

    const loadedRepository = await repository.$jazz.ensureLoaded({
      resolve: { pullRequests: true },
    })
    const pullRequests = Array.from(loadedRepository.pullRequests.values()) as PullRequest[]
    const pullRequest = pullRequests.find(current => current.id === pullRequestId)

    if (!pullRequest) {
      await ctx.answerCallbackQuery({ text: "Pull request не найден!", show_alert: true })
      return
    }

    await withRepositoryAccess(
      ctx,
      repository,
      "pull-request:read:repository",
      async () => {
        await ctx.answerCallbackQuery({
          text: "Доступ к pull request'ам запрещен!",
          show_alert: true,
        })
      },
      async () => {
        const [message, keyboard] = await Promise.all([
          renderPullRequest(pullRequest, repository),
          renderPullRequestListKeyboard(repository),
        ])

        keyboard.text("⬅️ К списку", `github:pull-requests:list:${repositoryId}`).row()
        keyboard.text("⬅️ К репозиториям", "github:pull-requests:repos").row()

        await ctx.editMessageText(message.value, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        })

        await ctx.answerCallbackQuery()
      },
    )
  })

  composer.callbackQuery("github:issues:repos", async ctx => {
    await showRepositorySelection(
      ctx,
      "issue:read:repository",
      "issues",
      count => `📁 Выберите репозиторий для просмотра задач (${count}).`,
      async (message, keyboard) => {
        await ctx.editMessageText(message, { reply_markup: keyboard })
        await ctx.answerCallbackQuery()
      },
    )
  })

  composer.callbackQuery("github:pull-requests:repos", async ctx => {
    await showRepositorySelection(
      ctx,
      "pull-request:read:repository",
      "pull-requests",
      count => `📁 Выберите репозиторий для просмотра pull request'ов (${count}).`,
      async (message, keyboard) => {
        await ctx.editMessageText(message, { reply_markup: keyboard })
        await ctx.answerCallbackQuery()
      },
    )
  })

  return composer
}
