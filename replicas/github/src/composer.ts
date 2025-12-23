import type { GitHubContract, Repository } from "@contracts/github.v1"
import type { Requirement } from "@reside/shared"
import type { Logger } from "pino"
import type { GitHubService } from "./service"
import { getRepositoryById, getRepositoryByOwnerAndName } from "@contracts/github.v1"
import { impersonateContext, type ResideTelegramContext } from "@contracts/telegram.v1"
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
  github: Requirement<GitHubContract>,
  getGitHubService: () => GitHubService | undefined,
  logger: Logger,
): Composer<ResideTelegramContext> {
  const composer = new Composer<ResideTelegramContext>()

  logger.debug("github composer initialized")

  const getRepositoryInstanceId = (repository: Repository): string => {
    return `${repository.owner}.${repository.name}`
  }

  const extractRepositoryParams = (value: unknown): { owner: string; name: string } | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null
    }

    const owner = (value as Record<string, unknown>).owner
    const name = (value as Record<string, unknown>).name

    if (typeof owner !== "string" || typeof name !== "string") {
      return null
    }

    return { owner, name }
  }

  const normalizeRepositoryKey = (owner: string, name: string): string => {
    return `${owner.toLowerCase()}::${name.toLowerCase()}`
  }

  const collectAccessibleRepositories = async (
    ctx: ResideTelegramContext,
    permissionKey: RepositoryPermissionKey | RepositoryPermissionKey[],
    options: { includeReadAll?: boolean } = {},
  ): Promise<RepositorySummary[]> => {
    return await impersonateContext(ctx, { github }, async ({ github }) => {
      const repositories = new Map<number, RepositorySummary>()
      const permissionKeys = Array.isArray(permissionKey) ? permissionKey : [permissionKey]

      const hasReadAll = options.includeReadAll
        ? await github.checkMyPermission("repository:read:all")
        : false

      if (hasReadAll) {
        const loadedData = await github.data.$jazz.ensureLoaded({
          resolve: {
            repositories: {
              $each: true,
            },
          },
        })

        for (const repository of loadedData.repositories.values()) {
          if (!repository) {
            continue
          }

          repositories.set(repository.id, {
            id: repository.id,
            owner: repository.owner,
            name: repository.name,
          })
        }
      } else {
        const instancesList = await Promise.all(
          permissionKeys.map(async key => await github.getPermissionInstances(key)),
        )

        const requestedRepositories = new Map<string, { owner: string; name: string }>()

        for (const instances of instancesList) {
          for (const params of Object.values(instances)) {
            const repositoryParams = extractRepositoryParams(params)
            if (!repositoryParams) {
              continue
            }

            const key = normalizeRepositoryKey(repositoryParams.owner, repositoryParams.name)
            if (!requestedRepositories.has(key)) {
              requestedRepositories.set(key, repositoryParams)
            }
          }
        }

        if (requestedRepositories.size === 0) {
          return []
        }

        for (const { owner, name } of requestedRepositories.values()) {
          const repository = await getRepositoryByOwnerAndName(github.data, owner, name)
          if (!repository) {
            continue
          }

          repositories.set(repository.id, {
            id: repository.id,
            owner: repository.owner,
            name: repository.name,
          })
        }
      }

      const sortedRepositories = Array.from(repositories.values())
      sortedRepositories.sort((a, b) => {
        const ownerComparison = a.owner.localeCompare(b.owner)
        if (ownerComparison !== 0) {
          return ownerComparison
        }

        return a.name.localeCompare(b.name)
      })

      return sortedRepositories
    })
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

  const ensureRepositoryAccess = async (
    requirement: Requirement<GitHubContract>,
    repository: Repository,
    permissionKey: RepositoryPermissionKey | RepositoryPermissionKey[],
    options: { allowRepositoryReadAll?: boolean } = {},
  ): Promise<boolean> => {
    if (options.allowRepositoryReadAll) {
      const hasReadAll = await requirement.checkMyPermission("repository:read:all")
      if (hasReadAll) {
        return true
      }
    }

    const permissionKeys = Array.isArray(permissionKey) ? permissionKey : [permissionKey]

    for (const key of permissionKeys) {
      const hasPermission = await requirement.checkMyPermission(
        key,
        getRepositoryInstanceId(repository),
      )

      if (hasPermission) {
        return true
      }
    }

    return false
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

    const repositories = await impersonateContext(ctx, { github }, async ({ github }) => {
      const loadedRepositories: Repository[] = []

      for (const summary of repositorySummaries) {
        const repository = await getRepositoryById(github.data, summary.id)
        if (repository) {
          loadedRepositories.push(repository)
        }
      }

      return loadedRepositories
    })

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

    await impersonateContext(ctx, { github }, async ({ github }) => {
      const repository = await getRepositoryById(github.data, repositoryId)
      if (!repository) {
        await ctx.answerCallbackQuery({ text: "Репозиторий не найден!", show_alert: true })
        return
      }

      const allowed = await ensureRepositoryAccess(github, repository, "issue:read:repository")
      if (!allowed) {
        await ctx.answerCallbackQuery({ text: "Доступ к задачам запрещен!", show_alert: true })
        return
      }

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
    })
  })

  composer.callbackQuery(/^github:issue:(\d+):(\d+)$/, async ctx => {
    const repositoryId = Number(ctx.match[1])
    const issueId = Number(ctx.match[2])

    await impersonateContext(ctx, { github }, async ({ github }) => {
      const repository = await getRepositoryById(github.data, repositoryId)
      if (!repository) {
        await ctx.answerCallbackQuery({ text: "Репозиторий не найден!", show_alert: true })
        return
      }

      const allowed = await ensureRepositoryAccess(github, repository, "issue:read:repository")
      if (!allowed) {
        await ctx.answerCallbackQuery({ text: "Доступ к задачам запрещен!", show_alert: true })
        return
      }

      const loadedRepository = await repository.$jazz.ensureLoaded({
        resolve: { issues: { $each: true } },
      })
      const issue = Array.from(loadedRepository.issues.values()).find(
        current => current.id === issueId,
      )

      if (!issue) {
        await ctx.answerCallbackQuery({ text: "Задача не найдена!", show_alert: true })
        return
      }

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
    })
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
    await impersonateContext(ctx, { github }, async ({ github }) => {
      const hasAccess = await github.checkMyPermission("repository:connect")

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

    await impersonateContext(ctx, { github }, async ({ github }) => {
      const repository = await getRepositoryById(github.data, repositoryId)
      if (!repository) {
        await ctx.answerCallbackQuery({ text: "Репозиторий не найден!", show_alert: true })
        return
      }

      const allowed = await ensureRepositoryAccess(
        github,
        repository,
        "pull-request:read:repository",
      )

      if (!allowed) {
        await ctx.answerCallbackQuery({
          text: "Доступ к pull request'ам запрещен!",
          show_alert: true,
        })
        return
      }

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
    })
  })

  composer.callbackQuery(/^github:pull-request:(\d+):(\d+)$/, async ctx => {
    const repositoryId = Number(ctx.match[1])
    const pullRequestId = Number(ctx.match[2])
    await impersonateContext(ctx, { github }, async ({ github }) => {
      const repository = await getRepositoryById(github.data, repositoryId)
      if (!repository) {
        await ctx.answerCallbackQuery({ text: "Репозиторий не найден!", show_alert: true })
        return
      }

      const allowed = await ensureRepositoryAccess(
        github,
        repository,
        "pull-request:read:repository",
      )

      if (!allowed) {
        await ctx.answerCallbackQuery({
          text: "Доступ к pull request'ам запрещен!",
          show_alert: true,
        })
        return
      }

      const loadedRepository = await repository.$jazz.ensureLoaded({
        resolve: { pullRequests: { $each: true } },
      })
      const pullRequest = Array.from(loadedRepository.pullRequests.values()).find(
        current => current.id === pullRequestId,
      )

      if (!pullRequest) {
        await ctx.answerCallbackQuery({ text: "Pull request не найден!", show_alert: true })
        return
      }

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
    })
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
    await impersonateContext(ctx, { github }, async ({ github }) => {
      const repository = await getRepositoryById(github.data, repositoryId)
      if (!repository) {
        await ctx.answerCallbackQuery({ text: "Репозиторий не найден!", show_alert: true })
        return
      }

      const allowed = await ensureRepositoryAccess(
        github,
        repository,
        ["issue:read:repository", "pull-request:read:repository"],
        { allowRepositoryReadAll: true },
      )

      if (!allowed) {
        await ctx.answerCallbackQuery({ text: "Доступ к репозиторию запрещен!", show_alert: true })
        return
      }

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
    })
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
