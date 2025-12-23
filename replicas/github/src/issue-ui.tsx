import type { Issue, Repository } from "@contracts/github.v1"
import type { MessageElement } from "@reside/telegram"
import { InlineKeyboard } from "grammy"
import type { co } from "jazz-tools"

const issueResolve = {
  info: true,
} as const

const repositoryIssuesResolve = {
  issues: {
    $each: {
      info: true,
    },
  },
} as const

export async function renderIssue(issue: Issue, repository: Repository): Promise<MessageElement> {
  const loadedIssue = await issue.$jazz.ensureLoaded({ resolve: issueResolve })

  return IssueView({ issue: loadedIssue, repository })
}

export async function renderIssueList(repository: Repository): Promise<MessageElement> {
  const loadedRepository = await repository.$jazz.ensureLoaded({ resolve: repositoryIssuesResolve })

  return IssueListView({ repository: loadedRepository })
}

export async function renderIssueListKeyboard(repository: Repository): Promise<InlineKeyboard> {
  const loadedRepository = await repository.$jazz.ensureLoaded({ resolve: repositoryIssuesResolve })
  const keyboard = new InlineKeyboard()

  const issues = Array.from(loadedRepository.issues.values())

  if (issues.length === 0) {
    keyboard.text("Обновить", `github:issues:list:${loadedRepository.id}`)
    return keyboard
  }

  for (const issue of issues) {
    const title = issue.info.title.trim() === "" ? `#${issue.id}` : issue.info.title

    keyboard.text(title.slice(0, 64), `github:issue:${loadedRepository.id}:${issue.id}`).row()
  }

  return keyboard
}

function IssueView({
  issue,
  repository,
}: {
  issue: co.loaded<typeof Issue, typeof issueResolve>
  repository: Repository
}): MessageElement {
  const body = issue.info.body?.trim()

  return (
    <div>
      <div>
        <b>Репозиторий:</b>{" "}
        <code>
          {repository.owner}/{repository.name}
        </code>
      </div>
      <div>
        <b>ID задачи:</b> <code>{issue.id}</code>
      </div>
      <br />
      <div>
        <b>{issue.info.title}</b>
      </div>
      <div>{body && body.length > 0 ? body : "Описание отсутствует."}</div>
    </div>
  )
}

function IssueListView({
  repository,
}: {
  repository: co.loaded<typeof Repository, typeof repositoryIssuesResolve>
}): MessageElement {
  const issues = Array.from(repository.issues.values())

  return (
    <div>
      <div>
        <b>Репозиторий:</b>
        <code>
          {repository.owner}/{repository.name}
        </code>
      </div>
      {issues.length === 0 ? (
        <div>Задачи отсутствуют.</div>
      ) : (
        <div>
          <b>Выберите задачу на клавиатуре ниже.</b>
        </div>
      )}
    </div>
  )
}
