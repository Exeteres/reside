import { TelegramContract, TelegramRealm } from "@contracts/telegram.v1"
import { TelegramHandlerContract } from "@contracts/telegram-handler.v1"
import { UserManagerContract } from "@contracts/user-manager.v1"
import { defineReplica } from "@reside/shared"
import { handler } from "./handler"

export const UserManagerSecretaryReplica = defineReplica({
  identity: "ghcr.io/exeteres/reside/replicas/user-manager-secretary",

  info: {
    name: "user-manager-secretary",
    class: "long-running",
    exclusive: true,
    scalable: true,
  },

  displayInfo: {
    ru: {
      title: "Секретарь Пользовательской Реплики",
      description: "Позволяет взаимодействовать с Пользовательской Репликой через Telegram-бота.",
    },
    en: {
      title: "User Manager Replica Secretary",
      description: "Enables interaction with the User Manager Replica via a Telegram bot.",
    },
  },

  requirements: {
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

  implementations: {
    telegramHandler: TelegramHandlerContract,
  },
})
