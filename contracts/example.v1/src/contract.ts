import { defineContract } from "@reside/shared"
import { co, z } from "jazz-tools"

export const ExampleContract = defineContract({
  identity: "ghcr.io/exeteres/reside/contracts/example.v1",

  data: co.map({
    version: z.number().optional(),
  }),

  displayInfo: {
    ru: {
      title: "Примерный контракт",
      description: "Контракт-шаблон для создания новых контрактов.",
    },
    en: {
      title: "Example Contract",
      description: "A template contract for creating new contracts.",
    },
  },

  migration: data => {
    const version = data.version ?? 0

    if (version < 1) {
      // migration logic for version 1
    }

    if (version !== 1) {
      data.$jazz.set("version", 1)
    }
  },
})
