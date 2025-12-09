import { defineSecret } from "@contracts/secret.v1"
import { z } from "jazz-tools"

export type AppConfig = z.infer<typeof appConfigSchema>

export const appConfigSchema = z.object({
  appId: z.string(),
  privateKey: z.string(),
  webhookSecret: z.string(),
})

export const config = defineSecret({
  name: "github",

  schema: z.object({
    app: appConfigSchema.optional(),
  }),

  displayInfo: {
    ru: {
      title: "Конфигурация GitHub приложения",
      description: "Настройки для подключения и управления GitHub приложением.",
    },
    en: {
      title: "GitHub App Configuration",
      description: "Settings for connecting and managing the GitHub application.",
    },
  },
})
