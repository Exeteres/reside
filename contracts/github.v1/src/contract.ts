import { defineContract, defineMethod } from "@reside/shared"
import { co, z } from "jazz-tools"
import { Issue } from "./issue"
import { getOrCreateRepository, Repository } from "./repository"

export type GitHubData = co.loaded<typeof GitHubContract.data>
export type GitHubContract = typeof GitHubContract

export const GitHubContract = defineContract({
  identity: "ghcr.io/exeteres/reside/contracts/github.v1",

  data: co.map({
    version: z.number().optional(),

    /**
     * The list of all repositories managed by this contract.
     */
    repositories: co.list(Repository),
  }),

  displayInfo: {
    ru: {
      title: "GitHub",
      description: "Позволяет взаимодействовать с репозиториями на GitHub.",
    },
    en: {
      title: "GitHub",
      description: "Allows interaction with repositories on GitHub.",
    },
  },

  migration: data => {
    const version = data.version ?? 0

    if (version < 1) {
      data.$jazz.set("repositories", GitHubContract.data.shape.repositories.create([]))
    }

    if (version !== 1) {
      data.$jazz.set("version", 1)
    }
  },

  methods: {
    connectRepository: {
      displayInfo: {
        ru: {
          title: "Подключить репозиторий",
          description: "Позволяет подключить новый репозиторий для управления.",
        },
        en: {
          title: "Connect repository",
          description: "Allows connecting a new repository for management.",
        },
      },

      definition: (url, workerId) => {
        return defineMethod({
          url,
          workerId,

          request: {},

          response: {
            schema: { connectionUrl: z.string() },
          },
        })
      },
    },

    createIssue: {
      displayInfo: {
        ru: {
          title: "Создать задачу",
          description: "Позволяет создавать новую задачу в указанном репозитории.",
        },
        en: {
          title: "Create issue",
          description: "Allows creating a new issue in the specified repository.",
        },
      },

      definition: (url, workerId) => {
        return defineMethod({
          url,
          workerId,

          request: {
            schema: {
              repositoryId: z.number(),
              title: z.string(),
              body: z.string().optional(),
            },
          },

          response: {
            schema: { issue: Issue },
            resolve: { issue: true },
          },
        })
      },
    },
  },

  permissions: {
    "repository:read:all": {
      displayInfo: {
        ru: {
          title: "Чтение всех репозиториев",
          description: "Позволяет просматривать все управляемые репозитории.",
        },
        en: {
          title: "Read all repositories",
          description: "Allows viewing all managed repositories.",
        },
      },

      params: z.object(),

      async onGranted(data, account) {
        const loadedData = await data.$jazz.ensureLoaded({ resolve: { repositories: true } })

        loadedData.repositories.$jazz.owner.addMember(account, "reader")
      },
    },

    "repository:connect": {
      displayInfo: {
        ru: {
          title: "Подключение репозитория",
          description: "Позволяет подключать новые репозитории к управлению.",
        },
        en: {
          title: "Connect repository",
          description: "Allows connecting new repositories for management.",
        },
      },

      params: z.object(),
    },

    "issue:read:repository": {
      displayInfo: {
        ru: {
          title: "Чтение задач в репозитории {owner}/{name}",
          description: "Позволяет просматривать задачи в репозитории {owner}/{name}.",
        },
        en: {
          title: "Read issues in repository {owner}/{name}",
          description: "Allows viewing issues in the repository {owner}/{name}.",
        },
      },

      getInstanceId: ({ owner, name }) => `${owner}.${name}`,

      params: z.object({
        owner: z.string(),
        name: z.string(),
      }),

      async onGranted(data, account, params) {
        const repository = await getOrCreateRepository(data, params.owner, params.name)
        const loadedRepository = await repository.$jazz.ensureLoaded({ resolve: { issues: true } })

        loadedRepository.issues.$jazz.owner.addMember(account, "reader")
      },
    },

    "issue:create:repository": {
      displayInfo: {
        ru: {
          title: "Создание задач в репозитории {owner}/{name}",
          description: "Позволяет создавать новые задачи в репозитории {owner}/{name}.",
        },
        en: {
          title: "Create issues in repository {owner}/{name}",
          description: "Allows creating new issues in the repository {owner}/{name}.",
        },
      },

      getInstanceId: ({ owner, name }) => `${owner}.${name}`,

      params: z.object({
        owner: z.string(),
        name: z.string(),
      }),
    },

    "pull-request:read:repository": {
      displayInfo: {
        ru: {
          title: "Чтение pull request'ов в репозитории {owner}/{name}",
          description: "Позволяет просматривать pull request'ы в репозитории {owner}/{name}.",
        },
        en: {
          title: "Read pull requests in repository {owner}/{name}",
          description: "Allows viewing pull requests in the repository {owner}/{name}.",
        },
      },

      getInstanceId: ({ owner, name }) => `${owner}.${name}`,

      params: z.object({
        owner: z.string(),
        name: z.string(),
      }),

      async onGranted(data, account, params) {
        const repository = await getOrCreateRepository(data, params.owner, params.name)
        const loadedRepository = await repository.$jazz.ensureLoaded({
          resolve: { pullRequests: true },
        })

        loadedRepository.pullRequests.$jazz.owner.addMember(account, "reader")
      },
    },
  },
})
