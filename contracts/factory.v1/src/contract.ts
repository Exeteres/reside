import { defineContract } from "@reside/shared"
import { co, z } from "jazz-tools"

export const FactoryContract = defineContract({
  identity: "ghcr.io/exeteres/reside/contracts/factory.v1",

  data: co.map({
    version: z.number().optional(),
  }),

  displayInfo: {
    ru: {
      title: "Завод Реплик",
      description: "Позволяет создавать новые реплики по запросам пользователей.",
    },
    en: {
      title: "Replica Factory",
      description: "Enables the creation of new replicas based on user requests.",
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

  methods: {},
})
