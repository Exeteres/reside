export const ru = {
  common: {
    requestSetApprovalTitle: "Подтверждение разрешений",
    noApproverApproved: "Нет подтверждающего, который одобрил запрос",
  },
  bootstrap: {
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
    },
  },
  operations: {
    requestPermissionSet: {
      title: "Запрос набора разрешений",
      description: "Ожидание подтверждения разрешений",
    },
  },
  approvalMessage: {
    scopeLine: (scope: string) => `   Скоуп: ${scope}`,
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
