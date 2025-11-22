import { defineSecret } from "@contracts/secret.v1"
import { z } from "jazz-tools"

export const config = defineSecret({
  name: "{replica.name}",

  schema: z.object({
    geminiToken: z
      .string()
      .meta({
        displayInfo: {
          ru: {
            title: "Токен Gemini",
            description: "Токен для доступа к API Gemini от Google.",
          },
          en: {
            title: "Gemini Token",
            description: "The token used to access the Gemini API from Google.",
          },
        },
      })
      .optional(),

    geminiModel: z
      .string()
      .meta({
        displayInfo: {
          ru: {
            title: "Модель Gemini",
            description: "Имя модели Gemini для использования (например, 'gemini-1.5-flash').",
          },
          en: {
            title: "Gemini Model",
            description: "The name of the Gemini model to use (e.g., 'gemini-1.5-flash').",
          },
        },
      })
      .optional(),
  }),

  displayInfo: {
    ru: {
      title: "Конфигурация Нейросетевой Реплики",
      description: "Настройки для нейросетевых бекендов и API.",
    },
    en: {
      title: "AI Replica Configuration",
      description: "Settings for AI backends and APIs.",
    },
  },
})
