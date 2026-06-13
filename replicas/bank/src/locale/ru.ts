export const ru = {
  bootstrap: {
    registration: {
      title: "Банковская Реплика",
      description: "Управляет виртуальной валютой «нихуя» (∅): балансом, историей и переводами.",
    },
  },
  commands: {
    balance: {
      title: "Показать баланс",
      description: "Показывает ваш баланс в валюте нихуя.",
    },
    transactions: {
      title: "Показать историю",
      description: "Показывает последние операции по вашему счету.",
    },
    securityAudit: {
      title: "Провести аудит безопасности",
      description: "Показывает отчет аудита безопасности банковской реплики.",
    },
    transfer: {
      title: "Перевести нихуя",
      description: "Переводит нихуя другому пользователю.",
      params: {
        user: {
          title: "Получатель",
          description: "Юзернейм или меншен получателя.",
        },
        amount: {
          title: "Сумма",
          description: "Количество нихуя для перевода.",
        },
      },
    },
  },
  notifications: {
    channels: {
      bank: {
        title: "Банковские операции",
        description: "Уведомления о балансе, истории и переводах.",
      },
    },
    balance: (amount: string) => `Баланс: ${amount} ∅`,
    transactions: {
      empty: "История операций пуста.",
      title: "Последние операции:",
    },
    securityAudit: {
      title: "Аудит безопасности банковской реплики",
      noCriticalOrHigh: "Критичные и высокорисковые проблемы не обнаружены.",
      findingsTitle: "Найденные риски и рекомендации:",
      severity: {
        medium: "средний",
        low: "низкий",
        info: "информация",
      },
    },
    transfer: {
      success: (amount: string) => `Переведено ${amount} ∅.`,
      failure: "Не удалось выполнить перевод.",
    },
    errors: {
      recipientRequired: "Получатель не найден.",
      invalidAmount: "Сумма должна быть положительным целым числом.",
      insufficientFunds: "Недостаточно нихуя.",
    },
  },
}
