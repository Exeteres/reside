import { SecretContract } from "@contracts/secret.v1"
import { defineReplica } from "@reside/shared"

export const SecretReplica = defineReplica({
  identity: "ghcr.io/exeteres/reside/replicas/secret",

  info: {
    name: "secret",
    class: "long-running",
    exclusive: true,
    scalable: true,
  },

  displayInfo: {
    ru: {
      title: "Секретная Реплика",
      description: "Хранит секреты и конфигурацию для других реплик.",
    },
    en: {
      title: "Secret Replica",
      description: "Stores secrets and configuration for other replicas.",
    },
  },

  implementations: {
    secret: SecretContract,
  },
})
