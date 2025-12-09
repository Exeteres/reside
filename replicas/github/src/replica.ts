import { GitHubContract } from "@contracts/github.v1"
import { SecretContract } from "@contracts/secret.v1"
import { TelegramContract, TelegramRealm } from "@contracts/telegram.v1"
import { TelegramHandlerContract } from "@contracts/telegram-handler.v1"
import { UserManagerContract } from "@contracts/user-manager.v1"
import { defineReplica } from "@reside/shared"
import { config } from "./config"
import { handler } from "./handler"

export const GithubReplica = defineReplica({
  identity: "ghcr.io/exeteres/reside/replicas/github",

  info: {
    name: "github",
    class: "long-running",
    exclusive: true,
    scalable: true,
  },

  displayInfo: {
    ru: {
      title: "Гитхабная Реплика",
      description: "Взаимодействует с репозиториями на GitHub.",
    },
    en: {
      title: "GitHub Replica",
      description: "Interacts with repositories on GitHub.",
    },
  },

  implementations: {
    github: GitHubContract,
    telegramHandler: TelegramHandlerContract,
  },

  requirements: {
    secret: {
      contract: SecretContract,
      permissions: [config.permissions.init, config.permissions.read],
    },
    telegram: {
      contract: TelegramContract,
      permissions: [handler.permission],
    },
    userManager: {
      contract: UserManagerContract,
      permissions: [
        TelegramRealm.permissions.read,
        TelegramRealm.permissions.readUsers,
        TelegramRealm.permissions.impersonateUsers,
      ],
    },
  },
})
