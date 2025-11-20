import { defineReplica } from "@reside/shared"

export const replica = defineReplica({
  identity: "ghcr.io/exeteres/reside/replicas/seed",

  info: {
    name: "seed",
    class: "oneshot",
    exclusive: true,
    scalable: false,
  },

  displayInfo: {
    en: {
      title: "Seed Replica",
      description: "Creates a Reside cluster to give life to other replicas.",
    },
    ru: {
      title: "Первоначальная Реплика",
      description: "Создает кластер Reside, чтобы дать жизнь другим репликам.",
    },
  },
})
