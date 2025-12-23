import { defineHandler } from "@contracts/telegram.v1"

export const handler = defineHandler({
  displayInfo: {
    ru: {
      title: "Обработчик для ПАДОРУ РЕПЛИКИ",
      description: "ПАДОРУ ПАДОРУ! Обрабатывает сообщения и команды, связанные с ПАДОРУ.",
    },
    en: {
      title: "Handler for PADORU REPLICA",
      description: "PADORU PADORU! Handles messages and commands related to PADORU.",
    },
  },

  allowedUpdates: ["message"],
})
