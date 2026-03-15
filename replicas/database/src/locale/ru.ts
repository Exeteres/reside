export const ru = {
  bootstrap: {
    registration: {
      title: "Базовая Реплика",
      description: "Предоставляет PostgreSQL и Temporal для других реплик.",
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
  },
}
