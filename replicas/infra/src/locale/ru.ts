export const ru = {
  bootstrap: {
    registration: {
      title: "Инфраструктурная Реплика",
      description: "Предоставляет базовую инфраструктуру для других реплик.",
    },
  },
  operations: {
    postgres: {
      title: (replicaNamespace: string) => `Подготовка базы данных для "${replicaNamespace}"`,
      description: (replicaNamespace: string) =>
        `Подготовка базы данных PostgreSQL для "${replicaNamespace}"`,
    },
    temporal: {
      title: (replicaNamespace: string) => `Подготовка Temporal для "${replicaNamespace}"`,
      description: (replicaNamespace: string) =>
        `Подготовка неймспейса Temporal для реплики "${replicaNamespace}"`,
    },
    storage: {
      title: (replicaNamespace: string) => `Подготовка хранилища для "${replicaNamespace}"`,
      description: (replicaNamespace: string) =>
        `Подготовка S3-бакета и ключей доступа для реплики "${replicaNamespace}"`,
    },
    gateway: {
      title: (gatewayName: string) => `Подготовка шлюза "${gatewayName}"`,
      description: (gatewayName: string) => `Подготовка HTTP-шлюза для "${gatewayName}"`,
    },
  },
}
