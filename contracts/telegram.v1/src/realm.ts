import { defineRealm } from "@contracts/user-manager.v1"

export const TelegramRealm = defineRealm({
  name: "telegram",

  displayInfo: {
    ru: {
      title: "Telegram",
      description: "Реалм для управления пользователями Telegram бота.",
    },
    en: {
      title: "Telegram",
      description: "Realm for managing Telegram bot users.",
    },
  },
})
