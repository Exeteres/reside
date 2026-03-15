export const ru = {
  bootstrap: {
    registration: {
      title: "Инженерная Реплика",
      description: "Собирает и настраивает новые реплики по инженерным задачам.",
    },
    permissions: {
      taskDefine: {
        title: "Создание инженерных задач",
        description:
          "Позволяет создавать и обновлять инженерные задачи через команду /create_task.",
      },
    },
  },
  commands: {
    createTask: {
      title: "Создать задачу",
      description: "Анализирует запрос и создает issue в GitHub.",
      parameters: {
        task: {
          title: "Задание",
          description: "Свободный текст с задачей пользователя.",
        },
      },
    },
  },
  notifications: {
    channels: {
      tasks: {
        title: "Инженерные задачи",
        description: "Уведомления по задачам, созданным командой /create_task.",
      },
    },
    taskAnalysis: {
      title: "Анализ запроса",
      creating: "Анализирую задачу перед созданием issue...",
      updating: "Анализирую ваш фидбек перед обновлением issue...",
    },
    taskCreated: {
      title: "Задача подготовлена",
      message: (repositoryUrl: string, issueUrl: string, issueTitle: string) =>
        [
          `Репозиторий: ${repositoryUrl}`,
          `Issue: ${issueUrl}`,
          `Заголовок: ${issueTitle}`,
          "",
          "Подтвердите реализацию, закройте задачу или отправьте текстом правки для обновления issue.",
        ].join("\n"),
      actions: {
        confirm: "Подтвердить",
        close: "Закрыть",
      },
    },
  },
}
