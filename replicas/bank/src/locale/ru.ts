export const ru = {
  bootstrap: {
    registration: {
      title: "Банковская Реплика",
      description: "Управляет виртуальной валютой нихуя.",
    },
  },
  commands: {
    balance: {
      title: "Показать баланс",
      description: "Показывает ваш баланс в ∅.",
    },
    transactions: {
      title: "Показать историю",
      description: "Показывает историю банковских транзакций.",
      params: {
        page: {
          title: "Страница",
          description: "Номер страницы истории.",
        },
      },
    },
    transfer: {
      title: "Перевести нихуя",
      description: "Переводит ∅ другому пользователю.",
      params: {
        user: {
          title: "Получатель",
          description: "Пользователь-получатель.",
        },
        amount: {
          title: "Сумма",
          description: "Количество ∅ для перевода.",
        },
      },
    },
    issueReplicaFunds: {
      title: "Выпустить средства реплике",
      description: "Увеличивает баланс указанной реплики.",
      params: {
        replicaName: {
          title: "Реплика",
          description: "Имя реплики-получателя.",
        },
        amount: {
          title: "Сумма",
          description: "Количество ∅ для выпуска.",
        },
      },
    },
  },
  notifications: {
    channels: {
      bank: {
        title: "Банк",
        description: "Уведомления банковской реплики.",
      },
    },
    bank: {
      balance: (amount: string) => `Баланс: ${amount} ∅`,
      transactions: {
        title: "История транзакций",
        empty: "Пока пусто",
      },
      transfer: (amount: string) => `Переведено ${amount} ∅`,
      issue: (amount: string, subjectId: string) => `Выпущено ${amount} ∅ для ${subjectId}`,
      failure: {
        title: "Банковская операция не выполнена",
        message: (error: string) => `Ошибка: ${error}`,
      },
    },
  },
}
