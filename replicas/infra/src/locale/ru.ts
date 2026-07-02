export const ru = {
  bootstrap: {
    registration: {
      title: "Инфраструктурная Реплика",
      description: "Предоставляет базовую инфраструктуру для других реплик.",
    },
    permissions: {
      temporaryPostgresDatabaseCreate: {
        title: "Создание временных баз данных PostgreSQL",
        description:
          "Позволяет создавать временные базы данных PostgreSQL для инженерных и тестовых задач.",
      },
    },
  },
  operations: {
    postgres: {
      title: (replicaNamespace: string) => `Подготовка базы данных для "${replicaNamespace}"`,
      description: (replicaNamespace: string) =>
        `Подготовка базы данных PostgreSQL для "${replicaNamespace}"`,
    },
    temporaryPostgres: {
      title: (ownerReplicaName: string) =>
        `Подготовка временной базы данных для "${ownerReplicaName}"`,
      description: (ownerReplicaName: string) =>
        `Подготовка временной базы данных PostgreSQL для "${ownerReplicaName}"`,
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
  reaper: {
    title: "Инфраструктурная Реплика",
    actions: {
      deleteDatabase: (name: string) => `Удаление базы данных ${name}`,
      deleteTemporalNamespace: (name: string) => `Удаление temporal-неймспейса ${name}`,
      deleteGateway: (name: string) => `Удаление шлюза ${name}`,
      deleteStorageBucket: (name: string) => `Удаление хранилища ${name}`,
    },
  },
}
