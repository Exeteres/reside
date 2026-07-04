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
  nls: {
    instructions:
      "Помогай пользователям управлять валютой «нихуя» (∅): показывать баланс, историю и выполнять переводы. Используй RHID текущего субъекта из контекста для операций пользователя. Для переводов получателю используй mentioned_user_*_subject_rhid из контекста или явно переданный opaque RHID. Не раскрывай внутренние зашифрованные значения.",
    tools: {
      balance:
        "Получает текущий баланс валюты для RHID субъекта Telegram. Используй RHID текущего субъекта, если пользователь явно не просит другой opaque RHID.",
      transactions:
        "Получает недавнюю историю операций для RHID субъекта Telegram. Используй RHID текущего субъекта, если пользователь явно не просит другой opaque RHID.",
      transfer:
        "Переводит валюту между RHID субъектов Telegram. Используй RHID текущего субъекта как отправителя, а mentioned_user_*_subject_rhid или явный RHID как получателя.",
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
      line: (createdAt: string, sign: string, amount: string, senderSubjectRhid: string) =>
        `${createdAt} ${sign}${amount} ∅, отправитель: ${senderSubjectRhid}`,
    },
    transfer: {
      success: (amount: string) => `Переведено ${amount} ∅.`,
      failure: "Не удалось выполнить перевод.",
    },
    errors: {
      recipientRequired: "Получатель не найден.",
      invalidAmount: "Сумма должна быть положительным целым числом.",
      insufficientFunds: "Недостаточно нихуя.",
      invalidRecipient: "Нельзя переводить самому себе.",
    },
  },
}
