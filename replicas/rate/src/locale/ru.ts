export const ru = {
  bootstrap: {
    registration: {
      title: "Реплика ключевой ставки",
      description: "Показывает актуальную ключевую ставку ЦБ РФ по команде /rate.",
    },
  },
  commands: {
    rate: {
      title: "Показать ключевую ставку",
      description: "Возвращает актуальную ключевую ставку ЦБ РФ.",
    },
  },
  notifications: {
    channels: {
      rate: {
        title: "Команда rate",
        description: "Уведомления о выполнении команды /rate.",
      },
    },
    rate: {
      success: {
        title: "Ключевая ставка ЦБ РФ: {value}%",
      },
      failure: {
        title: "Не удалось получить ключевую ставку",
      },
    },
  },
}
