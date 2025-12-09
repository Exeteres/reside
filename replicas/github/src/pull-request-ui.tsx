import type { PullRequest, Repository } from "@contracts/github.v1"
import type { MessageElement } from "@reside/telegram"
import { InlineKeyboard } from "grammy"
import type { co } from "jazz-tools"

const pullRequestResolve = {
  info: true,
} as const

const repositoryPullRequestsResolve = {
  pullRequests: {
    $each: {
      info: true,
    },
  },
} as const

export async function renderPullRequest(
  pullRequest: PullRequest,
  repository: Repository,
): Promise<MessageElement> {
  const loadedPullRequest = await pullRequest.$jazz.ensureLoaded({ resolve: pullRequestResolve })

  return PullRequestView({ pullRequest: loadedPullRequest, repository })
}

export async function renderPullRequestList(repository: Repository): Promise<MessageElement> {
  const loadedRepository = await repository.$jazz.ensureLoaded({
    resolve: repositoryPullRequestsResolve,
  })

  return PullRequestListView({ repository: loadedRepository })
}

export async function renderPullRequestListKeyboard(
  repository: Repository,
): Promise<InlineKeyboard> {
  const loadedRepository = await repository.$jazz.ensureLoaded({
    resolve: repositoryPullRequestsResolve,
  })
  const keyboard = new InlineKeyboard()

  const pullRequests = Array.from(loadedRepository.pullRequests.values())

  if (pullRequests.length === 0) {
    keyboard.text("Обновить", `github:pull-requests:list:${loadedRepository.id}`)
    return keyboard
  }

  for (const pullRequest of pullRequests) {
    const title =
      pullRequest.info.title.trim() === "" ? `#${pullRequest.id}` : pullRequest.info.title

    keyboard
      .text(title.slice(0, 64), `github:pull-request:${loadedRepository.id}:${pullRequest.id}`)
      .row()
  }

  return keyboard
}

function PullRequestView({
  pullRequest,
  repository,
}: {
  pullRequest: co.loaded<typeof PullRequest, typeof pullRequestResolve>
  repository: Repository
}): MessageElement {
  const body = pullRequest.info.body?.trim()

  return (
    <div>
      <div>
        <b>Репозиторий:</b>{" "}
        <code>
          {repository.owner}/{repository.name}
        </code>
      </div>
      <div>
        <b>ID pull request:</b> <code>{pullRequest.id}</code>
      </div>
      <br />
      <div>
        <b>{pullRequest.info.title}</b>
      </div>
      <div>{body && body.length > 0 ? body : "Описание отсутствует."}</div>
    </div>
  )
}

function PullRequestListView({
  repository,
}: {
  repository: co.loaded<typeof Repository, typeof repositoryPullRequestsResolve>
}): MessageElement {
  const pullRequests = Array.from(repository.pullRequests.values()) as PullRequest[]

  return (
    <div>
      <div>
        <b>Репозиторий:</b>{" "}
        <code>
          {repository.owner}/{repository.name}
        </code>
      </div>
      <div>
        <b>Количество pull request'ов:</b> <code>{pullRequests.length}</code>
      </div>
      {pullRequests.length === 0 ? (
        <div>Pull request'ы отсутствуют.</div>
      ) : (
        <div>
          <b>Выберите pull request на клавиатуре ниже.</b>
        </div>
      )}
    </div>
  )
}
