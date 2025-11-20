import { defineHandler } from "@contracts/telegram.v1"

export const handler = defineHandler({
  displayInfo: {
    ru: {
      title: "Глупый обработчик",
      description:
        "Глупый обработчик Глупой Реплики для тестирования взаимодействия с Telegram ботом.",
    },
    en: {
      title: "Silly handler",
      description:
        "A silly handler of the Silly Replica for testing interaction with a Telegram bot.",
    },
  },

  allowedUpdates: ["message"],
})
