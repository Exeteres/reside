import { SecretContract } from "@contracts/secret.v1"
import { TelegramContract, TelegramRealm } from "@contracts/telegram.v1"
import { UserManagerContract } from "@contracts/user-manager.v1"
import { defineReplica } from "@reside/shared"
import { config } from "./config"

export const TelegramReplica = defineReplica({
  identity: "ghcr.io/exeteres/reside/replicas/telegram",

  info: {
    name: "telegram",
    class: "long-running",
    exclusive: false,
    scalable: true,
  },

  displayInfo: {
    ru: {
      title: "Телеграмная Реплика",
      description: "Позволяет взаимодействовать с другими репликами через Telegram бота.",
    },
    en: {
      title: "Telegram Replica",
      description: "Enables interaction with other replicas via a Telegram bot.",
    },
  },

  implementations: {
    telegram: TelegramContract,
  },

  requirements: {
    secret: {
      contract: SecretContract,
      permissions: [config.permissions.init, config.permissions.read],
    },
    userManager: {
      contract: UserManagerContract,
      permissions: [
        TelegramRealm.permissions.init,
        TelegramRealm.permissions.readUsers,
        TelegramRealm.permissions.createUsers,
      ],
    },
  },
})
