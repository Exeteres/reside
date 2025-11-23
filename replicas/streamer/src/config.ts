import { defineSecret } from "@contracts/secret.v1"
import { z } from "jazz-tools"

export const config = defineSecret({
  name: "{replica.name}",

  schema: z.object({
    targets: z
      .record(z.string(), z.string())
      .optional()
      .meta({
        displayInfo: {
          ru: {
            title: "Таргеты для стриминга",
            description: "Маппинг названий таргетов на URL-ы стримов (RTMP).",
          },
          en: {
            title: "Streaming Targets",
            description: "Mapping of target names to stream URLs (RTMP).",
          },
        },
      }),
  }),

  displayInfo: {
    ru: {
      title: "Конфигурация Реплики-стримера",
      description: "Настройки для реплики, которая стримит в Telegram и на Youtube.",
    },
    en: {
      title: "Streamer Replica Configuration",
      description: "Settings for the replica that streams to Telegram and Youtube.",
    },
  },
})
