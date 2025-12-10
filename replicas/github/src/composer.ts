import type { Logger } from "pino"
import type { GitHubService } from "./service"
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
import {
  renderRepository,
  renderRepositoryList,
  renderRepositoryListKeyboard,
} from "./repository-ui"

type RepositoryPermissionKey = "issue:read:repository" | "pull-request:read:repository"

type RepositorySummary = {
  id: number
  owner: string
  name: string
}

export function createComposer(
  githubReplicaAccountId: string,
  getGitHubService: () => GitHubService | undefined,
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
    permissionKey: RepositoryPermissionKey | RepositoryPermissionKey[],
    options: { includeReadAll?: boolean } = {},
  ): Promise<RepositorySummary[]> => {
    const loadedUser = await ctx.user!.$jazz.ensureLoaded({ resolve: { user: true } })
    const repositories = new Map<number, RepositorySummary>()
    const permissionKeys = Array.isArray(permissionKey) ? permissionKey : [permissionKey]

    await TelegramRealm.impersonate(loadedUser.user, async account => {
      const requirement = await createRequirement(GitHubContract, githubReplicaAccountId, account)
      const hasReadAll = options.includeReadAll
        ? await requirement.checkPermission("repository:read:all")
        : false
      const instancesList = await Promise.all(
        permissionKeys.map(async key => {
          return await requirement.getPermissionInstances(key)
        }),
      )

      if (!hasReadAll && instancesList.every(instances => Object.keys(instances).length === 0)) {
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
        if (!hasReadAll) {
          const hasAccess = instancesList.some(instances => {
            return instanceId in instances
          })

          if (!hasAccess) {
            continue
          }
        }

        repositories.set(repository.id, {
          id: repository.id,
          owner: repository.owner,
          name: repository.name,
        })
      }
    })

    const sortedRepositories = Array.from(repositories.values())
    sortedRepositories.sort((a, b) => {
      const ownerComparison = a.owner.localeCompare(b.owner)
      if (ownerComparison !== 0) {
        return ownerComparison
      }

      return a.name.localeCompare(b.name)
    })

    return sortedRepositories
  }

  const buildRepositoryKeyboard = (
    repositories: RepositorySummary[],
    action: "issues" | "pull-requests" | "repositories",
  ): InlineKeyboard => {
    const keyboard = new InlineKeyboard()

    for (const repository of repositories) {
      const label = `${repository.owner}/${repository.name}`
      const callbackPrefix =
        action === "issues"
          ? "github:issues:list"
          : action === "pull-requests"
            ? "github:pull-requests:list"
            : "github:repositories:detail"

      keyboard.text(label, `${callbackPrefix}:${repository.id}`).row()
    }

    return keyboard
  }

  const showRepositorySelection = async (
    ctx: ResideTelegramContext,
    permissionKey: RepositoryPermissionKey | RepositoryPermissionKey[],
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
    permissionKey: RepositoryPermissionKey | RepositoryPermissionKey[],
    onDenied: () => Promise<void>,
    onGranted: () => Promise<void>,
    options: { allowRepositoryReadAll?: boolean } = {},
  ): Promise<void> => {
    const loadedUser = await ctx.user!.$jazz.ensureLoaded({ resolve: { user: true } })
    let allowed = false

    await TelegramRealm.impersonate(loadedUser.user, async account => {
      const requirement = await createRequirement(GitHubContract, githubReplicaAccountId, account)
      if (options.allowRepositoryReadAll) {
        const hasReadAll = await requirement.checkPermission("repository:read:all")
        if (hasReadAll) {
          allowed = true
          return
        }
      }

      const permissionKeys = Array.isArray(permissionKey) ? permissionKey : [permissionKey]

      for (const key of permissionKeys) {
        const hasPermission = await requirement.checkPermission(
          key,
          getRepositoryInstanceId(repository),
        )

        if (hasPermission) {
          allowed = true
          break
        }
      }
    })

    if (!allowed) {
      await onDenied()
      return
    }

    await onGranted()
  }

  const showRepositoryOverview = async (
    ctx: ResideTelegramContext,
    respond: (message: string, keyboard: InlineKeyboard) => Promise<unknown>,
  ): Promise<void> => {
    const repositorySummaries = await collectAccessibleRepositories(
      ctx,
      ["issue:read:repository", "pull-request:read:repository"],
      { includeReadAll: true },
    )

    if (repositorySummaries.length === 0) {
      await respond("Доступных репозиториев не найдено.", new InlineKeyboard())
      return
    }

    const repositories = (
      await Promise.all(repositorySummaries.map(summary => loadRepository(summary.id)))
    ).filter((repository): repository is Repository => repository !== null)

    if (repositories.length === 0) {
      await respond("Не удалось загрузить информацию о репозиториях.", new InlineKeyboard())
      return
    }

    const rendered = await renderRepositoryList(repositories)
    const keyboard = renderRepositoryListKeyboard(repositorySummaries)

    await respond(rendered.value, keyboard)
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

  composer.command("repositories", async ctx => {
    await showRepositoryOverview(ctx, async (message, keyboard) => {
      return await ctx.reply(message, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      })
    })
  })

  composer.command("connect_repository", async ctx => {
    const loadedUser = await ctx.user!.$jazz.ensureLoaded({ resolve: { user: true } })

    await TelegramRealm.impersonate(loadedUser.user, async account => {
      const github = await createRequirement(GitHubContract, githubReplicaAccountId, account)
      const hasAccess = await github.checkPermission("repository:connect")

      if (!hasAccess) {
        await ctx.reply("Нет доступа для подключения репозиториев.")
        return
      }

      const service = getGitHubService()
      if (!service) {
        await ctx.reply("Гитхабовое не настроено.")
        return
      }

      const connectionUrl = await service.app.getInstallationUrl()
      await ctx.reply(`Для подключения репозитория перейдите по ссылке: ${connectionUrl}`)
    })
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

  composer.callbackQuery(/^github:repositories:detail:(\d+)$/, async ctx => {
    const repositoryId = Number(ctx.match[1])
    const repository = await loadRepository(repositoryId)

    if (!repository) {
      await ctx.answerCallbackQuery({ text: "Репозиторий не найден!", show_alert: true })
      return
    }

    await withRepositoryAccess(
      ctx,
      repository,
      ["issue:read:repository", "pull-request:read:repository"],
      async () => {
        await ctx.answerCallbackQuery({ text: "Доступ к репозиторию запрещен!", show_alert: true })
      },
      async () => {
        const message = await renderRepository(repository)
        const keyboard = new InlineKeyboard()

        keyboard.text("⬅️ К репозиториям", "github:repositories:list").row()
        keyboard.text("➡️ Задачи", `github:issues:list:${repositoryId}`).row()
        keyboard.text("➡️ Pull request'ы", `github:pull-requests:list:${repositoryId}`).row()

        await ctx.editMessageText(message.value, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        })

        await ctx.answerCallbackQuery()
      },
      { allowRepositoryReadAll: true },
    )
  })

  composer.callbackQuery("github:repositories:list", async ctx => {
    await showRepositoryOverview(ctx, async (message, keyboard) => {
      await ctx.editMessageText(message, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      })

      await ctx.answerCallbackQuery()
    })
  })

  return composer
}
