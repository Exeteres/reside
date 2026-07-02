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
      planningTitle: (replicaName: string) => `План удаления реплики ${replicaName}`,
      planningMessage: "Выберите действия в списке задач и нажмите кнопку применения.",
      apply: "Применить",
      emptyTitle: (replicaName: string) => `Для реплики ${replicaName} не найдено ресурсов`,
      executingTitle: (replicaName: string) => `Удаление реплики ${replicaName}`,
      completedTitle: (replicaName: string) => `Удаление реплики ${replicaName} завершено`,
      failedTitle: (replicaName: string) => `Удаление реплики ${replicaName} завершено с ошибками`,
    },
  },
}
