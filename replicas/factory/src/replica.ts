import { defineReplica } from "@reside/shared"

export const FactoryReplica = defineReplica({
  identity: "ghcr.io/exeteres/reside/replicas/factory",

  info: {
    name: "factory",
    class: "long-running",
    exclusive: true,
    scalable: true,
  },

  displayInfo: {
    ru: {
      title: "Заводская Реплика",
      description: "Создает новые реплики по запросам пользователей.",
    },
    en: {
      title: "Factory Replica",
      description: "Creates new replicas based on user requests.",
    },
  },
})
