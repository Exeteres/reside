export const ru = {
  bootstrap: {
    registration: {
      title: "Реплика-Убийца",
      description: "Планирует и выполняет удаление ресурсов других реплик.",
    },
    permissions: {
      handlerRegister: {
        title: "Регистрация обработчика Реплики-Убийцы",
        description: "Позволяет реплике зарегистрировать обработчик удаления своих ресурсов.",
      },
    },
  },
  commands: {
    kill: {
      title: "Удалить реплику",
      description: "Планирует удаление ресурсов выбранной реплики и запускает выбранные действия.",
      params: {
        replicaName: {
          title: "Имя реплики",
          description: "Техническое имя реплики, которую нужно удалить.",
        },
      },
    },
  },
  notifications: {
    channels: {
      command: {
        title: "Удаление реплик",
        description: "Планы и статусы удаления ресурсов реплик.",
      },
    },
    kill: {
      planningTitle: (replicaName: string) => `Запланировано удаление реплики ${replicaName}`,
      planningMessage: "Выберите нужные действия.",
      apply: "Выполнить",
      emptyTitle: (replicaName: string) => `Для реплики ${replicaName} не найдено ресурсов`,
      executingTitle: (replicaName: string) => `Удаление реплики ${replicaName}`,
      completedTitle: (replicaName: string) => `Удаление реплики ${replicaName} завершено`,
      failedTitle: (replicaName: string) => `Удаление реплики ${replicaName} завершено с ошибками`,
    },
  },
}
