export const ru = {
  bootstrap: {
    registration: {
      title: "Альфа Реплика",
      description: "Управляет загрузкой реплик и хранит их реестр.",
    },
    realm: {
      description: "Здесь живут реплики.",
    },
    permissions: {
      loadReplica: {
        title: "Загрузка реплики в кластер",
        description: "Позволяет загружать реплику с заданным именем в кластер.",
      },
    },
  },
  server: {
    registration: {
      operations: {
        reconcileReplica: {
          title: "Ожидание готовности реплики",
          description: "Ожидает применения CRD и готовности реплики.",
          failureMessage: "Не удалось завершить регистрацию, реплика больше не существует.",
        },
      },
    },
    load: {
      unknownReplicaTitle: "Неизвестная реплика",
      operations: {
        reconcileReplica: {
          title: "Ожидание загрузки реплики",
          description: "Ожидает применения CRD и готовности загруженной реплики.",
        },
      },
    },
  },
}
