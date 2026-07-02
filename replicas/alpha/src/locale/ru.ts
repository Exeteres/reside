export const ru = {
  commands: {
    replicas: {
      title: "Реплики",
      description: "Показывает зарегистрированные реплики и их параметры.",
    },
    setReplicaNode: {
      title: "Назначить узел реплике",
      description: "Привязывает реплику к конкретному Kubernetes-узлу.",
      params: {
        replica: {
          title: "Реплика",
          description: "Техническое имя реплики.",
        },
        node: {
          title: "Узел",
          description: "Значение kubernetes.io/hostname целевого узла.",
        },
      },
    },
    resetReplicaNode: {
      title: "Сбросить узел реплики",
      description: "Убирает привязку реплики к Kubernetes-узлу.",
      params: {
        replica: {
          title: "Реплика",
          description: "Техническое имя реплики.",
        },
      },
    },
  },
  bootstrap: {
    registration: {
      title: "Альфа Реплика",
      description: "Управляет загрузкой реплик и хранит их реестр.",
    },
    channels: {
      replicas: {
        title: "Реестр реплик",
      },
      releaseNotes: {
        title: "Релизные заметки реплик",
      },
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
  reaper: {
    title: "Альфа-Реплика",
    actions: {
      unregister: "Снятие регистрации",
      deleteFromCluster: "Удаление из кластера",
    },
  },
  workflows: {
    replicas: {
      empty: {
        title: "Реестр реплик",
        message: "Зарегистрированные реплики не найдены.",
      },
      list: {
        title: "Реестр реплик",
        message: (count: number) => `Выберите реплику из списка (${count}).`,
      },
      details: {
        title: (replicaTitle: string) => `Реплика: ${replicaTitle}`,
        back: "Назад к списку",
        name: (name: string) => `Имя: ${name}`,
        description: (description: string) => `Описание: ${description}`,
        image: (image: string) => `Образ: ${image}`,
        internalEndpoint: (endpoint: string) => `Внутренний endpoint: ${endpoint}`,
        publicEndpoint: (endpoint: string) => `Публичный endpoint: ${endpoint}`,
        node: (node: string) => `Узел: ${node}`,
        version: (version: string) => `Версия: v${version}`,
        changes: (changes: string) => `Изменения: ${changes}`,
      },
    },
    replicaNode: {
      set: {
        success: {
          title: "Узел реплики обновлен",
          message: (replicaName: string, nodeName: string) =>
            `Для реплики "${replicaName}" задан узел "${nodeName}".`,
        },
      },
      reset: {
        success: {
          title: "Узел реплики сброшен",
          message: (replicaName: string) => `Привязка к узлу для реплики "${replicaName}" удалена.`,
        },
      },
      failure: {
        title: "Не удалось обновить узел реплики",
        nodeNotFound: (nodeName: string) => `Узел "${nodeName}" не найден в кластере.`,
        replicaNotFound: (replicaName: string) =>
          `Реплика "${replicaName}" не зарегистрирована в Alpha.`,
        generic: (replicaName: string, nodeName: string | undefined, errorMessage: string) =>
          nodeName
            ? `Не удалось назначить узел "${nodeName}" для реплики "${replicaName}": ${errorMessage}`
            : `Не удалось обновить узел для реплики "${replicaName}": ${errorMessage}`,
      },
    },
    releaseNotes: {
      title: "Реплика обновлена",
      replicaLabel: "Реплика:",
      versionLabel: "Версия:",
      changesLabel: "Изменения:",
      unknownChanges: "Нет описания изменений.",
    },
  },
}
