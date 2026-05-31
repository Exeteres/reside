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
    },
  },
  operations: {
    requestPermissionSet: {
      title: "Запрос набора разрешений",
      description: "Ожидание подтверждения разрешений",
    },
  },
  approvalMessage: {
    requestNumberLabel: "Номер запроса:",
    subjectLabel: "Субъект:",
    requestedByLabel: "Запросил:",
    permissionsHeader: "Разрешения:",
    reasonHeader: "Причина:",
  },
  e2e: {
    localApproverTitle: "E2E подтверждающий",
    localApproverDescription: "Локальный подтверждающий для e2e",
    autoApprovalDescription: "Автоматическое подтверждение для e2e",
    autoApprovalResolution: "Автоподтверждение e2e",
  },
}
