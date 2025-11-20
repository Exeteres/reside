import { defineHandler } from "@contracts/telegram.v1"

export const handler = defineHandler({
  displayInfo: {
    ru: {
      title: "Обработчик команд Альфа-Реплики",
      description: "Обрабатывает команды Telegram-бота для взаимодействия с Альфа-Репликой.",
    },
    en: {
      title: "Alpha Replica Command Handler",
      description: "Handles Telegram bot commands for interacting with the Alpha Replica.",
    },
  },

  allowedUpdates: ["message", "callback_query"],
})
