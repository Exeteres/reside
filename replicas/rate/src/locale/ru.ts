export const ru = {
  bootstrap: {
    registration: {
      title: "Ключевая Реплика",
      description: "Возвращает актуальную ключевую ставку ЦБ РФ.",
    },
  },
  commands: {
    rate: {
      title: "Ключевая ставка",
      description: "Возвращает актуальную ключевую ставку ЦБ РФ.",
    },
  },
  notifications: {
    channels: {
      rate: {
        title: "Ключевая ставка",
        description: "Уведомления с актуальной ключевой ставкой ЦБ РФ.",
      },
    },
    rate: {
      title: (rate: number) => `Ключевая ставка ЦБ РФ: ${rate}%`,
      errorTitle: "Не удалось получить актуальную ключевую ставку ЦБ РФ.",
    },
  },
}
