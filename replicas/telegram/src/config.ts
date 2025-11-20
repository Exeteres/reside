import { defineSecret } from "@contracts/secret.v1"
import { z } from "jazz-tools"

export const config = defineSecret({
  name: "{replica.name}",

  schema: z.object({
    botToken: z
      .string()
      .meta({
        displayInfo: {
          ru: {
            title: "Токен бота",
            description: "Токен для управления Telegram ботом. Можно получить у бота @BotFather.",
          },
          en: {
            title: "Bot Token",
            description:
              "The token used to manage the Telegram bot. Can be obtained from the @BotFather bot.",
          },
        },
      })
      .optional(),

    notificationChatId: z
      .number()
      .meta({
        displayInfo: {
          ru: {
            title: "ID чата для уведомлений",
            description:
              "Идентификатор чата, куда бот будет отправлять уведомления и системные сообщения.",
          },
          en: {
            title: "Notification Chat ID",
            description:
              "The identifier of the chat where the bot will send notifications and system messages.",
          },
        },
      })
      .optional(),
  }),

  displayInfo: {
    ru: {
      title: "Конфигурация Telegram бота",
      description: "Настройки для подключения и управления Telegram ботом.",
    },
    en: {
      title: "Telegram Bot Configuration",
      description: "Settings for connecting and managing the Telegram bot.",
    },
  },
})
