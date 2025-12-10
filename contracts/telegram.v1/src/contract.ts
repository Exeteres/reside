import type { ApiResponse, UserFromGetMe } from "grammy/types"
import { TelegramUser } from "@contracts/telegram-handler.v1"
import { defineContract, defineMethod, typedJson } from "@reside/shared"
import { co, z } from "jazz-tools"
import { getOrCreateManagedHandler, ManagedHandler } from "./handler"

export type TelegramContract = typeof TelegramContract
export type TelegramData = co.loaded<typeof TelegramContract.data>

export const TelegramContract = defineContract({
  identity: "ghcr.io/exeteres/reside/contracts/telegram.v1",

  data: co.map({
    version: z.number().optional(),

    /**
     * The up-to-date information about the bot.
     */
    me: typedJson<UserFromGetMe>().optional(),

    /**
     * The list of managed handlers.
     */
    handlers: co.list(ManagedHandler),

    /**
     * The list of users who have interacted with the bot.
     */
    users: co.list(TelegramUser),
  }),

  migration: data => {
    const version = data.version ?? 0

    if (version < 1) {
      data.$jazz.set("handlers", TelegramContract.data.shape.handlers.create([]))
      data.$jazz.set("users", TelegramContract.data.shape.users.create([]))
    }

    if (version !== 1) {
      data.$jazz.set("version", 1)
    }
  },

  displayInfo: {
    ru: {
      title: "Телеграмная Реплика",
      description: "Контракт для взаимодействия с телеграм-ботом через Телеграмную Реплику.",
    },
    en: {
      title: "Telegram Replica",
      description: "Contract for interacting with a Telegram bot via the Telegram Replica.",
    },
  },

  methods: {
    callBotApi: {
      displayInfo: {
        ru: {
          title: "Вызов Bot API",
          description:
            "Позволяет вызывать методы Bot API. Сам токен при этом не раскрывается и отфильтровывается из всех результатов.",
        },
        en: {
          title: "Call Bot API",
          description:
            "Allows calling Telegram Bot API methods. The token is not exposed and filtered out from all results.",
        },
      },

      definition: (url, workerId) => {
        return defineMethod({
          url,
          workerId,

          request: {
            methodName: z.string(),
            headers: z.record(z.string(), z.string()),
            bodyType: z.enum(["json", "base64"]),
            body: z.string(),
          },

          response: {
            result: typedJson<ApiResponse<unknown>>(),
          },
        })
      },
    },
  },

  permissions: {
    "handler:setup": {
      params: z.object({
        /**
         * The name of the handler to create.
         */
        name: z.string().meta({
          displayInfo: {
            ru: {
              title: "Имя обработчика",
              description: "Уникальное имя для создаваемого обработчика.",
            },
            en: {
              title: "Handler Name",
              description: "A unique name for the handler being created.",
            },
          },
        }),
      }),

      instanceKeys: ["name"],

      displayInfo: {
        ru: {
          title: "Установка обработчика",
          description:
            "Позволяет создать обработчик для взаимодействия с телеграм-ботом и использовать его.",
        },
        en: {
          title: "Setup handler",
          description:
            "Allows creating a handler for interacting with the Telegram bot and using it.",
        },
      },

      onGranted: async (data, account, params) => {
        const handler = await getOrCreateManagedHandler(data, params.name, account)

        const loadedHandler = await handler.$jazz.ensureLoaded({
          resolve: {
            definition: true,
          },
        })

        // allow RW definition
        loadedHandler.definition.$jazz.owner.addMember(account, "writer")
      },

      onRevoked: async (data, account, params) => {
        const handler = await getOrCreateManagedHandler(data, params.name, account)

        const loadedHandler = await handler.$jazz.ensureLoaded({
          resolve: {
            definition: true,
          },
        })

        // remove RW on definition
        loadedHandler.definition.$jazz.owner.removeMember(account)
      },
    },

    "handler:read:all": {
      params: z.object(),

      displayInfo: {
        ru: {
          title: "Чтение всех обработчиков",
          description: "Позволяет читать все созданные обработчики и их определения.",
        },
        en: {
          title: "Read all handlers",
          description: "Allows reading all created handlers and their definitions.",
        },
      },

      onGranted: async (data, account) => {
        const loadedData = await data.$jazz.ensureLoaded({ resolve: { handlers: true } })

        loadedData.handlers.$jazz.owner.addMember(account, "reader")
      },

      onRevoked: async (data, account) => {
        const loadedData = await data.$jazz.ensureLoaded({ resolve: { handlers: true } })

        loadedData.handlers.$jazz.owner.removeMember(account)
      },
    },

    "user:read:all": {
      params: z.object(),

      displayInfo: {
        ru: {
          title: "Чтение всех пользователей",
          description: "Позволяет читать всех пользователей, взаимодействовавших с ботом.",
        },
        en: {
          title: "Read all users",
          description: "Allows reading all users who have interacted with the bot.",
        },
      },

      onGranted: async (data, account) => {
        const loadedData = await data.$jazz.ensureLoaded({ resolve: { users: true } })

        loadedData.users.$jazz.owner.addMember(account, "reader")
      },

      onRevoked: async (data, account) => {
        const loadedData = await data.$jazz.ensureLoaded({ resolve: { users: true } })

        loadedData.users.$jazz.owner.removeMember(account)
      },
    },
  },
})
