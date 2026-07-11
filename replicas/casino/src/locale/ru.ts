export const ru = {
  bootstrap: {
    registration: {
      title: "Азартная Реплика",
      description: "Принимает ставки на кубик и выплачивает выигрыши через банк.",
    },
    bankPaymentRequestReason: "Для запроса оплаты ставок у пользователей Телеграмной Реплики.",
  },
  commands: {
    bet: {
      title: "Сделать ставку",
      description: "Ставит ∅ на выбранные грани кубика.",
      params: {
        amount: {
          title: "Сумма",
          description: "Размер ставки в ∅.",
        },
        sides: {
          title: "Грани",
          description: "Грани кубика: 1,2,3, 1-3 или 1,2-4,6. По умолчанию 1-3.",
        },
      },
    },
  },
  notifications: {
    channels: {
      casino: {
        title: "Казино",
        description: "Уведомления Азартной Реплики.",
      },
    },
    bet: {
      rejected: {
        title: "Ставка отклонена",
        invalidAmount: "Сумма ставки должна быть положительным целым числом.",
        invalidSides: "Грани указаны неправильно.",
        invalidSideValue: "Грани кубика должны быть от 1 до 6.",
        emptySides: "Нужно выбрать хотя бы одну грань кубика.",
        fractionalPayout: "Такая ставка дает дробный выигрыш, а банк переводит только целые ∅.",
        insufficientFunds: "Казино не может покрыть возможный выигрыш.",
        example: "Пример: /bet 10 1-3",
      },
      payment: {
        title: "Подтвердите ставку",
        confirmBank: "Подтвердите оплату в запросе банка.",
        throwAfterPayment: "После оплаты бросьте один кубик 🎲 в этот чат.",
        bankComment: (sides: string, payoutAmount: string) =>
          `Ставка в Азартной Реплике: грани ${sides}, возможный выигрыш ${payoutAmount} ∅.`,
      },
      paymentRejected: {
        title: "Ставка отменена",
        content: "Оплата ставки отклонена. Игра не началась.",
      },
      waitingDice: {
        title: "Бросьте кубик 🎲",
        paymentAccepted: "Оплата получена.",
        prompt: "Отправьте один кубик 🎲 в этот чат.",
      },
      lost: {
        title: "Вы проиграли",
        content: (amount: string) => `Ставка ${amount} ∅ остается у казино.`,
      },
      wonPending: {
        title: "Вы выиграли",
        payout: (payoutAmount: string) => `Выигрыш: ${payoutAmount} ∅`,
        sending: "Отправляю выплату.",
      },
      payoutRetrying: {
        title: "Выплата задерживается",
      },
      paid: {
        title: "Выигрыш выплачен",
      },
      payoutComment: (betId: number) => `Выигрыш в Азартной Реплике по ставке #${betId}.`,
      failed: {
        title: "Ставка не завершена",
        beforePayment: "Не удалось создать ставку. Деньги не списаны.",
      },
    },
  },
  labels: {
    bet: "Ставка",
    sides: "Грани",
    multiplier: "Множитель",
    payout: "Возможный выигрыш",
    dice: "Выпало",
    selectedSides: "Ваши грани",
    paid: "Выплачено",
    transaction: "Транзакция",
  },
  errors: {
    positiveAmount: "Сумма ставки должна быть положительным целым числом",
    invalidSides: "Грани указаны неправильно",
    invalidSideValue: "Грани кубика должны быть от 1 до 6",
    emptySides: "Нужно выбрать хотя бы одну грань кубика",
    fractionalPayout: "Такая ставка дает дробный выигрыш",
    insufficientCasinoFunds: "Казино не может покрыть возможный выигрыш",
    invalidBalance: "Банк вернул некорректный баланс казино",
    invalidPayout: "Некорректный размер выигрыша",
  },
}
