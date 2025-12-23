import type { Repository } from "@contracts/github.v1"
import type { MessageElement } from "@reside/telegram"
import { InlineKeyboard } from "grammy"
import type { co } from "jazz-tools"

const repositoryResolve = {
  issues: true,
  pullRequests: true,
} as const

type LoadedRepository = co.loaded<typeof Repository, typeof repositoryResolve>

type RepositorySummary = {
  id: number
  owner: string
  name: string
}

const statusLabels: Record<LoadedRepository["status"], string> = {
  "not-connected": "Не подключен",
  connected: "Подключен",
  "lost-connection": "Подключение потеряно",
}

export async function renderRepository(repository: Repository): Promise<MessageElement> {
  const loadedRepository = await repository.$jazz.ensureLoaded({ resolve: repositoryResolve })

  return RepositoryView({ repository: loadedRepository })
}

export async function renderRepositoryList(repositories: Repository[]): Promise<MessageElement> {
  const loadedRepositories = (await Promise.all(
    repositories.map(async repository => {
      return await repository.$jazz.ensureLoaded({ resolve: repositoryResolve })
    }),
  )) as LoadedRepository[]

  return RepositoryListView({ repositories: loadedRepositories })
}

export function renderRepositoryListKeyboard(summaries: RepositorySummary[]): InlineKeyboard {
  const keyboard = new InlineKeyboard()

  for (const summary of summaries) {
    const label = `${summary.owner}/${summary.name}`
    keyboard.text(label, `github:repositories:detail:${summary.id}`).row()
  }

  return keyboard
}

function RepositoryView({ repository }: { repository: LoadedRepository }): MessageElement {
  const installationId = repository.installationId
  const issues = Array.from(repository.issues.values())
  const pullRequests = Array.from(repository.pullRequests.values())

  return (
    <div>
      <div>
        <b>Репозиторий:</b>
        <code>
          {repository.owner}/{repository.name}
        </code>
      </div>
      <div>
        <b>Статус:</b> <code>{statusLabels[repository.status]}</code>
      </div>
      <div>
        <b>Installation ID:</b> <code>{installationId ?? "-"}</code>
      </div>
      <div>
        <b>Количество задач:</b> <code>{issues.length}</code>
      </div>
      <div>
        <b>Количество pull request'ов:</b> <code>{pullRequests.length}</code>
      </div>
    </div>
  )
}

function RepositoryListView({
  repositories,
}: {
  repositories: LoadedRepository[]
}): MessageElement {
  return (
    <div>
      <div>
        <b>Количество репозиториев:</b> <code>{repositories.length}</code>
      </div>
      {repositories.length === 0 ? (
        <div>Доступных репозиториев не найдено.</div>
      ) : (
        <div>
          <b>Доступные репозитории:</b>
          <br />
          {repositories.map(repository => {
            return (
              <div>
                <code>
                  {repository.owner}/{repository.name}
                </code>{" "}
                - {statusLabels[repository.status]}
              </div>
            )
          })}
          <br />
          <div>
            <b>Выберите репозиторий на клавиатуре ниже.</b>
          </div>
        </div>
      )}
    </div>
  )
}
