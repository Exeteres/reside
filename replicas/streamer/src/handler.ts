import { defineHandler } from "@contracts/telegram.v1"

export const handler = defineHandler({
  displayInfo: {
    ru: {
      title: "Обработчик для Реплики-стримера",
      description: "Обрабатывает сообщения и команды, связанные со стримингом.",
    },
    en: {
      title: "Handler for Streamer Replica",
      description: "Handles messages and commands related to streaming.",
    },
  },

  allowedUpdates: ["message"],
})
