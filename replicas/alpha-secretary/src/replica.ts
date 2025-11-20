import { AlphaContract } from "@contracts/alpha.v1"
import { TelegramContract, TelegramRealm } from "@contracts/telegram.v1"
import { TelegramHandlerContract } from "@contracts/telegram-handler.v1"
import { UserManagerContract } from "@contracts/user-manager.v1"
import { defineReplica } from "@reside/shared"
import { handler } from "./handler"

export const AlphaSecretaryReplica = defineReplica({
  identity: "ghcr.io/exeteres/reside/replicas/alpha-secretary",

  info: {
    name: "alpha-secretary",
    class: "long-running",
    exclusive: true,
    scalable: true,
  },

  displayInfo: {
    ru: {
      title: "Секретарь Альфа-Реплики",
      description: "Позволяет взаимодействовать с Альфа-Репликой через Telegram-бота.",
    },
    en: {
      title: "Alpha Replica Secretary",
      description: "Enables interaction with the Alpha Replica via a Telegram bot.",
    },
  },

  requirements: {
    alpha: {
      contract: AlphaContract,
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

  implementations: {
    telegramHandler: TelegramHandlerContract,
  },
})
