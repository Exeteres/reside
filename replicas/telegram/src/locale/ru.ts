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
      nlsClearSubjectContext: {
        title: "Очистка NLS-контекста субъекта",
        description:
          "Позволяет очищать NLS-контекст любого субъекта выбранного реалма. Scope: {realm}",
      },
    },
    nlsImpersonationReason:
      "Телеграмной Реплике нужно вызывать NLS от имени пользователей Telegram-реалма и очищать их контекст.",
    channels: {
      avatarProvisioning: {
        title: "Создание аватаров реплик",
        description: "Уведомления с запросами на создание управляемых ботов-аватаров.",
      },
      avatarPrivacyMode: {
        title: "Проблемы доставки аватаров",
        description: "Уведомления о проблемах доставки сообщений ботами-аватарами.",
      },
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
      editTasks: "Изменить задачи",
      editTasksPollTitle: "Какие задачи оставить?",
      editTasksTextTitle: "Какие задачи оставить?",
      editTasksTextInstruction:
        "Ответьте на это сообщение номерами задач, которые нужно оставить. Можно указать отдельные номера или диапазоны через запятую, пробел или перенос строки, например: 1, 3-5.",
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
  reaper: {
    title: "Телеграмная Реплика",
    actions: {
      deleteCommands: (count: number) => `Удаление ${count} команд`,
      deleteChannels: (count: number) => `Удаление ${count} каналов`,
      deleteAvatar: (name: string) => `Удаление аватара ${name}`,
      deleteNlsInteractions: (count: number) => `Удаление ${count} NLS-сессий`,
    },
  },
  worker: {
    workflows: {
      avatarProvisioning: {
        title: (replicaTitle: string) => `Создание аватара для ${replicaTitle}`,
        createdTitle: (replicaTitle: string) => `Аватар для ${replicaTitle} создан`,
        content: "Нажмите на кнопку ниже и завершите создание аватара для реплики.",
        createdContent: "Добавьте созданного бота в текущий чат.",
        openCreationLink: "Создать аватар",
        timeoutMessage: "Не удалось дождаться создания аватара за отведенное время (24 часа).",
      },
      activityReward: {
        transactionTitle: "Награда за активность",
      },
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
      pong: "pong",
      nlsReplicaUnavailable: "Реплика не отвечает на NLS-запрос (что-то там про плохой шлюз)",
      nlsReplicaBroken: "Реплика вернула ошибку при обработке NLS-запроса",
      nlsSessionOwnedByAnotherUser: (replicaName: string) =>
        `Эта NLS-сессия принадлежит другому пользователю. Начните новую, упомянув реплику ${replicaName}.`,
      nlsClearContextUsage: "Использование: /clear_context <реплика>",
      nlsClearContextReplicaNotFound: (replicaName: string) =>
        `Реплика «${replicaName}» не найдена.`,
      nlsClearContextSucceeded: (replicaName: string) =>
        `NLS-контекст для реплики «${replicaName}» очищен.`,
      nlsClearContextFailed: "Не удалось очистить NLS-контекст.",
      unexpectedError: "Что-то пошло не так",
      notificationTaskSelectionInvalid:
        "Не удалось разобрать ответ. Укажите номера задач или диапазоны, например: 1, 3-5.",
      parameterRequired: (parameterName: string) =>
        `Обязательный параметр "${parameterName}" не указан`,
      parameterMustBeInteger: (parameterName: string) =>
        `Параметр "${parameterName}" должен быть целым числом`,
      parameterMustBeBoolean: (parameterName: string) =>
        `Параметр "${parameterName}" должен быть true/false`,
      parameterMustBeUser: (parameterName: string) =>
        `Параметр "${parameterName}" должен быть упоминанием, именем пользователя или ID`,
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
      notificationChannelBinding: {
        bindUsage: "Использование: /bind_notification_channel <канал>",
        unbindUsage: "Использование: /unbind_notification_channel <канал>",
        bound: (channelTitle: string) =>
          `Канал уведомлений «${channelTitle}» привязан к этому чату.`,
        boundToTopic: (channelTitle: string, topicTitle: string) =>
          `Канал уведомлений «${channelTitle}» привязан к теме «${topicTitle}».`,
        unbound: (channelTitle: string) => `Привязка канала уведомлений «${channelTitle}» удалена.`,
        noBinding: (channelTitle: string) =>
          `У канала уведомлений «${channelTitle}» не было привязки.`,
        failed: "Не удалось изменить привязку канала уведомлений.",
        topicFallbackTitle: (messageThreadId: number) => `Тема ${messageThreadId}`,
      },
      notificationInfo: {
        usage: "Ответьте командой /info на уведомление.",
        notFound: "В ответе нет известного уведомления.",
        title: "Информация об уведомлении",
        channelSection: "Канал уведомлений",
        channelTitle: (title: string) => `Название: ${title}`,
        channelName: (name: string) => `Имя: ${name}`,
        channelDescription: (description: string) => `Описание: ${description}`,
        senderSection: "Субъект-отправитель",
        senderTitle: (title: string) => `Название: ${title}`,
        senderSubjectId: (subjectId: string) => `ID: ${subjectId}`,
        senderUnknown: "Субъект не указан.",
      },
    },
    ecidSubstitution: {
      decryptReason: "Для отображения зашифрованных данных пользователю",
      unavailableValue: "ДАННЫЕ НЕДОСТУПНЫ",
      nullValue: "пустое значение",
      booleanTrue: "да",
      booleanFalse: "нет",
      emptyArray: "пустой массив",
      objectWithFieldCount: (fieldCount: number) => `объект с ${fieldCount} полями`,
      arrayOfObjects: (count: number) => `массив из ${count} объектов`,
      arrayWithElementCount: (count: number) => `массив из ${count} элементов`,
      stringArrayTwo: (first: string, second: string) => `${first} и ${second}`,
      stringArrayMany: (first: string, second: string, restCount: number) =>
        `${first}, ${second} и ещё ${restCount} элементов`,
    },
  },
}
