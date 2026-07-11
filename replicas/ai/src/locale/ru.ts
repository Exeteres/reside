export const ru = {
  bootstrap: {
    registration: {
      title: "Нейросетевая Реплика",
      description: "Создает изображения по текстовому описанию.",
    },
  },
  commands: {
    image: {
      title: "Создать изображение",
      description: "Создает изображение заданного размера по текстовому описанию.",
      params: {
        size: {
          title: "Размер",
          description: "Размер изображения, например 1024x1024.",
        },
        prompt: {
          title: "Описание",
          description: "Текстовое описание изображения.",
        },
      },
    },
  },
  notifications: {
    channels: {
      ai: {
        title: "Нейросетевые изображения",
        description: "Уведомления с созданными изображениями.",
      },
    },
    ai: {
      success: {
        title: "Изображение создано",
      },
      failure: {
        title: "Не удалось создать изображение",
      },
    },
  },
}
