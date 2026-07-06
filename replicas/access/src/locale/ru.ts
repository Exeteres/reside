export const ru = {
  common: {
    requestSetApprovalTitle: "Подтверждение разрешений",
    noApproverApproved: "Нет подтверждающего, который одобрил запрос",
    approvalWorkflowFailed: "Ошибка выполнения процесса подтверждения",
  },
  bootstrap: {
    registration: {
      title: "Авторизационная Реплика",
      description: "Управляет доступом к ресурсам внутри экосистемы Reside.",
    },
    permissions: {
      realmManage: {
        title: "Управление реалмом",
        description:
          "Позволяет управлять реалмом с заданным именем, включая его создание, обновление, удаление, а также управление всеми его субъектами.",
      },
      permissionManage: {
        title: "Управление разрешением",
        description:
          "Позволяет управлять разрешением с заданным именем, включая его создание, обновление и удаление.",
      },
      approverManage: {
        title: "Управление подтверждающим",
        description:
          "Позволяет управлять подтверждающим с заданными параметрами. Scope: {name}:{priority}:{realm1}:{realm2}:...",
      },
      subjectRead: {
        title: "Чтение субъектов реалма",
        description:
          "Позволяет получать отображаемую информацию о субъектах конкретного реалма через Access Реплику.",
      },
      interactionNlsAsk: {
        title: "NLS-запрос между субъектами",
        description:
          "Позволяет выполнять NLS-запрос от одного субъекта к другому. Scope: {to_subject_id}",
      },
      interactionNlsImpersonate: {
        title: "NLS-имперсонация по реалму",
        description: "Позволяет вызывать NLS от имени субъекта выбранного реалма. Scope: {realm}",
      },
      encryptionTransfer: {
        title: "Передача зашифрованного содержимого",
        description:
          "Позволяет передавать зашифрованное содержимое из выбранной реплики. Scope: {replica_name}",
      },
    },
  },
  operations: {
    requestPermissionSet: {
      title: "Запрос набора разрешений",
      description: "Ожидание подтверждения разрешений",
    },
  },
  reaper: {
    title: "Авторизационная Реплика",
    actions: {
      deleteBindings: (count: number) => `Удаление ${count} биндингов`,
      deleteRestrictions: (count: number) => `Удаление ${count} ограничений`,
      deleteApprover: (name: string) => `Удаление подтверждающего ${name}`,
    },
  },
  approvalMessage: {
    requestNumberLabel: "Номер запроса:",
    subjectLabel: "Субъект:",
    requestedByLabel: "Запросил:",
    permissionsHeader: "Разрешения:",
    reasonHeader: "Причина:",
  },
  notifications: {
    channels: {
      permissionRequests: {
        title: "Запросы разрешений",
        description: "Уведомления о подтверждении запросов разрешений.",
      },
    },
    permissionRequests: {
      statusLabel: "Статус:",
      historyHeader: "История решений:",
      approverLabel: "Подтверждающий:",
      decisionLabel: "Решение:",
      resolutionLabel: "Резолюция:",
      emptyResolution: "(без резолюции)",
      started: {
        title: "Начато подтверждение разрешений",
        status: "Процесс подтверждения начат.",
      },
      waitingApprover: {
        title: "Ожидается решение подтверждающего",
        status: (approverTitle: string) => `Ожидается решение ${approverTitle}`,
      },
      escalated: {
        title: "Запрос разрешений эскалирован",
        status: "Запрос эскалирован к следующему подтверждающему",
      },
      humanApproval: {
        title: "Требуется подтверждение разрешений",
        status: "Автоматические подтверждающие исчерпаны. Ожидается решение человека",
        approverName: "human",
        approverTitle: "Человек",
        actions: {
          approve: "Подтвердить",
          reject: "Отклонить",
        },
        approvedResolution: "Запрос подтвержден человеком",
        rejectedResolution: "Запрос отклонен человеком",
      },
      approved: {
        title: "Запрос разрешений одобрен",
        status: "Запрос одобрен",
      },
      rejected: {
        title: "Запрос разрешений отклонен",
        status: "Запрос отклонен",
      },
      decisions: {
        approved: "Одобрено",
        rejected: "Отклонено",
        escalated: "Эскалировано",
      },
    },
  },
  e2e: {
    localApproverTitle: "E2E подтверждающий",
    localApproverDescription: "Локальный подтверждающий для e2e",
    autoApprovalDescription: "Автоматическое подтверждение для e2e",
    autoApprovalResolution: "Автоподтверждение e2e",
  },
}
