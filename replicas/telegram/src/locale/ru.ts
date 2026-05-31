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
        title: "Управление командой",
        description:
          "Позволяет создавать, изменять и удалять конкретную команду Телеграмной Реплики.",
      },
      commandInvoke: {
        title: "Вызов команды",
        description: "Позволяет вызывать конкретную команду Телеграмной Реплики.",
      },
      notificationChannelManage: {
        title: "Управление каналом уведомлений",
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
      avatarOwn: {
        title: "Управление аватаром",
        description: "Позволяет реплике создать и использовать бота-аватара.",
      },
      nlsAsk: {
        title: "NLS-вызов между субъектами",
        description:
          "Позволяет выполнять NLS-запрос от одного субъекта к другому. Scope: {to_subject_id}",
      },
      nlsImpersonate: {
        title: "NLS-имперсонация реалма",
        description: "Позволяет вызывать NLS от имени субъекта выбранного реалма. Scope: {realm}",
      },
    },
    nlsImpersonationReason:
      "Телеграмной Реплике нужно вызывать NLS от имени пользователей Telegram-реалма.",
    channels: {
      approvals: {
        title: "Подтверждения",
        description: "Уведомления для подтверждения запросов доступа.",
      },
      avatarProvisioning: {
        title: "Создание аватаров реплик",
        description: "Уведомления с запросами на создание управляемых ботов-аватаров.",
      },
      avatarPrivacyMode: {
        title: "Проблемы доставки аватаров",
        description: "Уведомления о проблемах доставки сообщений ботами-аватарами.",
      },
    },
    approver: {
      title: "Telegram-подтверждение",
      description: "Автоматическое подтверждение запросов для Telegram-реалма",
    },
    gateway: {
      title: "Шлюз Телеграмной Реплики",
      description: "HTTP-шлюз для входящих webhook-обновлений Telegram.",
    },
  },
  server: {
    approval: {
      defaultTitle: "Подтверждение запроса",
    },
    notification: {
      responseOperationTitle: "Ожидание ответа на уведомление",
      chooseAction: "Выберите действие",
      avatarProvisionOperationTitle: "Ожидание создания Telegram-аватара",
      avatarProvisionOperationDescription:
        "Ожидает создание управляемого Telegram-бота для реплики.",
      avatarPrivacyModeWarningTitle: "Проблемы при доставке сообщений аватаром",
      avatarPrivacyModeWarningContent: (botUsername: string) =>
        `У @${botUsername} Включен Privacy Mode. Отключите его через /setprivacy у BotFather для корректной отправки сообщений.`,
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
      avatarProvisioning: {
        title: (replicaTitle: string) => `Создание аватара для ${replicaTitle}`,
        createdTitle: (replicaTitle: string) => `Аватар для ${replicaTitle} создан`,
        content: "Нажмите на кнопку ниже и завершите создание аватара для реплики.",
        createdContent: "Добавьте созданного бота в текущий чат.",
        openCreationLink: "Создать аватар",
        timeoutMessage: "Не удалось дождаться создания аватара за отведенное время (24 часа).",
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
      autoRequestNotificationInteractReason: (channelName: string) =>
        `Автоматический запрос разрешения на взаимодействие с каналом уведомлений ${channelName}`,
      autoRequestNlsReason: (toSubjectId: string) =>
        `Автоматический запрос NLS-разрешения для обращения к ${toSubjectId}`,
    },
    bot: {
      commandNotFound: (commandName: string) => `Команда "${commandName}" не найдена`,
      commandExecutionFailed: "Не удалось выполнить команду",
      commandReplicaUnavailable: "Реплика не отвечает (что-то там про плохой шлюз)",
      commandReplicaBroken: "Реплика ответила с ошибкой",
      nlsReplicaUnavailable: "Реплика не отвечает на NLS-запрос (что-то там про плохой шлюз)",
      nlsReplicaBroken: "Реплика вернула ошибку при обработке NLS-запроса",
      nlsSessionOwnedByAnotherUser: (replicaName: string) =>
        `Эта NLS-сессия принадлежит другому пользователю. Начните новую, упомянув реплику ${replicaName}.`,
      unexpectedError: "Что-то пошло не так",
      parameterRequired: (parameterName: string) =>
        `Обязательный параметр "${parameterName}" не указан`,
      parameterMustBeInteger: (parameterName: string) =>
        `Параметр "${parameterName}" должен быть целым числом`,
      parameterMustBeBoolean: (parameterName: string) =>
        `Параметр "${parameterName}" должен быть true/false`,
      acceptedSuffix: (subjectTitle: string, date: string, time: string) =>
        `${subjectTitle} ответил ${date} в ${time} MSK`,
      acceptedActionSuffix: (
        subjectTitle: string,
        optionName: string,
        date: string,
        time: string,
      ) => `${subjectTitle} выбрал "${optionName}" ${date} в ${time} MSK`,
      systemTitle: "Система",
      privateChatTitle: "Личный чат",
      chatById: (chatId: string | number) => `Чат ${chatId}`,
      userById: (userId: string | number) => `Пользователь ${userId}`,
    },
  },
}
