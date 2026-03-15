export const ru = {
  common: {
    accessDenied: "Доступ запрещен!",
    user: "Пользователь",
  },
  bootstrap: {
    registration: {
      title: "Телеграмная Реплика",
      description: "Обрабатывает Telegram-команды и уведомления.",
    },
    realmDescription:
      "Здесь находятся Telegram-пользователи, с которыми взаимодействует Телеграмная Реплика.",
    permissions: {
      commandManage: {
        title: "Управление командой Телеграмной Реплики",
        description:
          "Позволяет создавать, изменять и удалять конкретную команду Телеграмной Реплики.",
      },
      commandInvoke: {
        title: "Вызов команды Телеграмной Реплики",
        description: "Позволяет вызывать конкретную команду Телеграмной Реплики.",
      },
      notificationChannelManage: {
        title: "Управление каналом уведомлений Телеграмной Реплики",
        description:
          "Позволяет создавать, изменять и удалять конкретный канал уведомлений Телеграмной Реплики.",
      },
      notificationChannelInteract: {
        title: "Взаимодействие с каналами уведомлений",
        description:
          "Позволяет отвечать на уведомления Телеграмной Реплики в конкретном канале уведомлений.",
      },
      notificationSendAsSubject: {
        title: "Отправка уведомлений от имени субъекта",
        description:
          "Позволяет отправлять уведомления Телеграмной Реплики от имени конкретного субъекта.",
      },
      approve: {
        title: "Подтверждение запросов доступа",
        description:
          "Позволяет подтверждать запросы доступа от конкретной реплики через Телеграмную Реплику.",
      },
    },
    channels: {
      approvals: {
        title: "Подтверждения",
        description: "Уведомления для подтверждения запросов доступа.",
      },
    },
    approver: {
      title: "Telegram-подтверждение",
      description: "Автоматическое подтверждение запросов для Telegram-реалма",
    },
  },
  server: {
    approval: {
      defaultTitle: "Подтверждение запроса",
    },
    notification: {
      responseOperationTitle: "Ожидание ответа на уведомление",
      chooseAction: "Выберите действие",
    },
    subject: {
      userById: (telegramId: string | number) => `Пользователь ${telegramId}`,
    },
  },
  worker: {
    workflows: {
      approvalCancellationMessage: "Запрос был отменен.",
      approvalActions: {
        approve: "Подтвердить",
        reject: "Отклонить",
        escalate: "Эскалировать",
      },
    },
    activities: {
      approvalResolutionApproved: "Запрос подтвержден в Telegram",
      approvalResolutionRejected: "Запрос отклонен в Telegram",
      approvalResolutionEscalated: "Запрос эскалирован в Telegram",
    },
    authorization: {
      autoRequestReason: (commandName: string) =>
        `Автоматический запрос разрешения для команды /${commandName}`,
    },
    bot: {
      commandNotFound: (commandName: string) => `Команда "${commandName}" не найдена`,
      commandExecutionFailed: "Не удалось выполнить команду",
      unexpectedError: "Что-то пошло не так",
      parameterRequired: (parameterName: string) =>
        `Обязательный параметр "${parameterName}" не указан`,
      parameterMustBeInteger: (parameterName: string) =>
        `Параметр "${parameterName}" должен быть целым числом`,
      parameterMustBeBoolean: (parameterName: string) =>
        `Параметр "${parameterName}" должен быть true/false`,
      acceptedSuffix: (subjectTitle: string, date: string, time: string) =>
        `${subjectTitle} ответил ${date} в ${time} MSK`,
      systemTitle: "Система",
      privateChatTitle: "Личный чат",
      chatById: (chatId: string | number) => `Чат ${chatId}`,
      userById: (userId: string | number) => `Пользователь ${userId}`,
    },
  },
}
