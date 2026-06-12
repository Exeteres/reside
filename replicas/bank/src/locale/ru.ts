export const ru = {
  bootstrap: {
    registration: {
      title: "Банковская реплика",
      description: "Управляет виртуальной валютой «нихуя» (∅).",
    },
  },
  commands: {
    balance: {
      title: "Показать баланс",
      description: "Показывает текущий баланс в ∅.",
    },
    history: {
      title: "Показать историю",
      description: "Показывает последние операции в ∅.",
    },
    transfer: {
      title: "Перевести ∅",
      description: "Переводит ∅ пользователю по юзернейму или меншену.",
    },
  },
  notifications: {
    channels: {
      bank: {
        title: "Банк",
        description: "Уведомления банковской реплики.",
      },
    },
    balance: (amount: string) => `Баланс: ${amount} ∅`,
    historyEmpty: "Операций пока нет.",
    historyTitle: "История операций",
    transferSuccess: (amount: string, recipient: string, balance: string) =>
      `Переведено ${amount} ∅ пользователю ${recipient}. Баланс: ${balance} ∅`,
    transferFailure: "Перевод не выполнен",
  },
}
