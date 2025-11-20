import { TelegramContract } from "@contracts/telegram.v1"
import { TelegramHandlerContract } from "@contracts/telegram-handler.v1"
import { defineReplica } from "@reside/shared"
import { handler } from "./handler"

export const SillyReplica = defineReplica({
  identity: "ghcr.io/exeteres/reside/replicas/silly",

  info: {
    name: "silly",
    class: "long-running",
    exclusive: false,
    scalable: true,
  },

  displayInfo: {
    ru: {
      title: "Глупая Реплика",
      description: "Простая реплика для тестирования взаимодействия с Telegram ботом.",
    },
    en: {
      title: "Silly Replica",
      description: "A simple replica for testing interaction with a Telegram bot.",
    },
  },

  implementations: {
    telegramHandler: TelegramHandlerContract,
  },

  requirements: {
    telegram: {
      contract: TelegramContract,
      permissions: [handler.permission],
    },
  },
})
