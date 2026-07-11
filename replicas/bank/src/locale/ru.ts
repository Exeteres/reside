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
      paymentRequests: {
        title: "Запросы оплаты",
        description: "Подтверждения платежей для других реплик.",
      },
    },
    bank: {
      balance: (amount: string) => `Баланс: ${amount} ∅`,
      transactions: {
        title: "История транзакций",
        empty: "Пока пусто",
        actions: {
          previous: "Назад",
          next: "Вперед",
        },
      },
      transfer: (amount: string) => `Переведено ${amount} ∅`,
      issue: (amount: string, subjectId: string) => `Выпущено ${amount} ∅ для ${subjectId}`,
      paymentRequest: {
        title: "Запрос оплаты",
        operationTitle: "Подтверждение оплаты",
        operationDescription: (amount: string, requesterSubjectId: string) =>
          `Запрос на оплату ${amount} ∅ для ${requesterSubjectId}.`,
        message: (amount: string, requesterSubjectId: string) =>
          `Реплика ${requesterSubjectId} просит оплатить ${amount} ∅.`,
        comment: (comment: string) => `Комментарий: ${comment}`,
        actions: {
          accept: "Оплатить",
          acceptAlways: "Оплачивать всегда",
          reject: "Отклонить",
        },
        approved: (amount: string) => `Оплачено ${amount} ∅`,
        approvedAlways: (amount: string) =>
          `Оплачено ${amount} ∅. Следующие запросы будут оплачиваться автоматически.`,
        rejected: "Запрос оплаты отклонен",
      },
      failure: {
        title: "Банковская операция не выполнена",
      },
    },
  },
  errors: {
    differentTransferSubjects: "Отправитель и получатель должны отличаться",
    insufficientFunds: "Недостаточно нихуя",
    paymentRequestPayloadMismatch:
      "Ключ идемпотентности уже использован для другого запроса оплаты",
    paymentRequestMissingTransaction: "Подтвержденный запрос оплаты не содержит транзакцию",
    positiveAmount: "Сумма должна быть положительной",
    integerAmount: "Сумма должна быть целым числом",
    integerField: (fieldName: string) => `Поле "${fieldName}" должно быть целым числом`,
  },
}
