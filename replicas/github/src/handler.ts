import { defineHandler } from "@contracts/telegram.v1"

export const handler = defineHandler({
  displayInfo: {
    ru: {
      title: "Гитхабный обработчик",
      description: "Обработчик Гитхабной Реплики для взаимодействия с репозиториями на GitHub.",
    },
    en: {
      title: "GitHub handler",
      description: "Handler of the GitHub Replica for interacting with repositories on GitHub.",
    },
  },

  allowedUpdates: ["message"],
})
