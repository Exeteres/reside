import { AlphaContract } from "@contracts/alpha.v1"
import { SecretContract } from "@contracts/secret.v1"
import { TelegramContract } from "@contracts/telegram.v1"
import { TelegramHandlerContract } from "@contracts/telegram-handler.v1"
import { defineReplica } from "@reside/shared"
import { config } from "./config"
import { handler } from "./handler"

export const StreamerReplica = defineReplica({
  identity: "ghcr.io/exeteres/reside/replicas/streamer",

  info: {
    name: "streamer",
    class: "long-running",
    exclusive: false,
    scalable: true,
  },

  displayInfo: {
    ru: {
      title: "Реплика-стример",
      description: "Записывает происходящее безобразие и стримит в Telegram и на Youtube.",
    },
    en: {
      title: "Streamer Replica",
      description: "Records the ongoing chaos and streams it to Telegram and Youtube.",
    },
  },

  implementations: {
    telegramHandler: TelegramHandlerContract,
  },

  requirements: {
    alpha: {
      contract: AlphaContract,
      permissions: [{ name: "replica:read:all" }],
    },
    secret: {
      contract: SecretContract,
      permissions: [config.permissions.init, config.permissions.read],
    },
    telegram: {
      contract: TelegramContract,
      permissions: [handler.permission],
    },
  },
})
