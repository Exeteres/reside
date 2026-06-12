export const ru = {
  bootstrap: {
    registration: {
      title: "Примерная Реплика",
      description: "Показывает базовые шаблоны базы данных, S3, NLS, команд и воркфлоу.",
    },
  },
  commands: {
    example: {
      title: "Создать примерную заметку",
      description: "Создает зашифрованную заметку и связанный объект в S3.",
      params: {
        text: {
          title: "Текст заметки",
          description: "Текст, который будет сохранен в зашифрованном виде.",
        },
      },
    },
  },
  notifications: {
    channels: {
      example: {
        title: "Команда example",
        description: "Уведомления о выполнении команды /example.",
      },
    },
    example: {
      success: {
        title: "Создана примерная заметка {id}",
      },
      failure: {
        title: "Не удалось создать примерную заметку",
      },
    },
  },
}
