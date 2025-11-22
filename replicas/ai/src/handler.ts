import { defineHandler } from "@contracts/telegram.v1"

export const handler = defineHandler({
  displayInfo: {
    ru: {
      title: "Нейросетевой обработчик",
      description: "Позволяет взаимодействовать с Нейросетевой Репликой через Telegram-бота.",
    },
    en: {
      title: "AI Handler",
      description: "Enables interaction with the AI Replica via a Telegram bot.",
    },
  },

  allowedUpdates: ["message"],
})
