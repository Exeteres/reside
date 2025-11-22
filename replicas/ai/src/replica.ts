import { SecretContract } from "@contracts/secret.v1"
import { TelegramContract } from "@contracts/telegram.v1"
import { TelegramHandlerContract } from "@contracts/telegram-handler.v1"
import { defineReplica } from "@reside/shared"
import { config } from "./config"
import { handler } from "./handler"

export const AIReplica = defineReplica({
  identity: "ghcr.io/exeteres/reside/replicas/ai",

  info: {
    name: "ai",
    class: "long-running",
    exclusive: false,
    scalable: true,
  },

  displayInfo: {
    ru: {
      title: "Нейросетевая Реплика",
      description: "Работает с LLM и другими AI-взаимодействиями.",
    },
    en: {
      title: "AI Replica",
      description: "Handles LLM and other AI interactions.",
    },
  },

  implementations: {
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
  },
})
