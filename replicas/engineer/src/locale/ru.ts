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
    taskPlanning: {
      readyTitle: "План готов",
      readyMessage: (
        repositoryUrl: string,
        issueUrl: string,
        issueTitle: string,
        resultSummary: string,
      ) =>
        [
          `Репозиторий: ${repositoryUrl}`,
          `Issue: ${issueUrl}`,
          `Заголовок: ${issueTitle}`,
          "",
          "Резюме:",
          resultSummary,
          "",
          "Подтвердите запуск реализации, отмените задачу или отправьте текстом правки к плану.",
        ].join("\n"),
      actions: {
        approve: "Запустить реализацию",
        cancel: "Отменить задачу",
      },
    },
    taskExecution: {
      inProgressTitle: "Выполнение задачи",
      inProgressMessage: "Запускаю новую итерацию выполнения...",
      runningAwaitingInput:
        "Итерация выполняется. Можно отменить задачу кнопкой. Текстовые правки сейчас отклоняются.",
      cancellationRequested: "Отмена запрошена. Ожидаю остановку текущей итерации.",
      changeRejectedWhileRunning:
        "Правки во время выполнения отклонены. Дождитесь завершения и отправьте новый фидбек.",
      doneTitle: "Итерация завершена",
      failedTitle: "Итерация завершилась с ошибкой",
      awaitingNextActionTitle: "Ожидаю следующее действие",
      awaitingNextActionMessage:
        "Отправьте фидбек текстом для новой итерации или нажмите отмену задачи.",
      initialPrompt: "Реализуй утвержденный план задачи.",
      defaultSummary: "Итерация завершена, но агент не предоставил итоговое резюме.",
      defaultFailure: "Итерация завершилась с ошибкой без подробного сообщения.",
      cancelledSummary: "Итерация остановлена по запросу отмены.",
      actions: {
        cancel: "Отменить задачу",
      },
    },
  },
}
