import { defineReplica } from "@reside/shared"

export const ExampleReplica = defineReplica({
  identity: "ghcr.io/exeteres/reside/replicas/example",

  info: {
    name: "example",
    class: "long-running",
    exclusive: false,
    scalable: true,
  },

  displayInfo: {
    ru: {
      title: "Примерная Реплика",
      description: "Это примерная реплика, которая служит шаблоном для создания новых реплик.",
    },
    en: {
      title: "Example Replica",
      description:
        "This is an example replica that serves as a template for creating new replicas.",
    },
  },
})
