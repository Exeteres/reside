import type { Update } from "grammy/types"
import { defineContract, defineMethod, typedJson } from "@reside/shared"
import { co, z } from "jazz-tools"
import { TelegramUser } from "./user"

export type TelegramHandlerContract = typeof TelegramHandlerContract

export const TelegramHandlerContract = defineContract({
  identity: "ghcr.io/exeteres/reside/contracts/telegram-handler.v1",

  displayInfo: {
    ru: {
      title: "Обработчик телеграм событий",
      description:
        "Контракт для обработки входящих событий от Telegram. Его использует Телеграмная Реплика для доставки событий в другие реплики.",
    },
    en: {
      title: "Telegram Event Handler",
      description:
        "Contract for handling incoming events from Telegram. Used by the Telegram Replica to deliver events to other replicas.",
    },
  },

  data: co.map({}),

  methods: {
    handleUpdate: {
      displayInfo: {
        ru: {
          title: "Обработать обновление из Телеграма",
          description: "Обрабатывает входящее обновление из Телеграма.",
        },
        en: {
          title: "Handle telegram update",
          description: "Handles an incoming update from Telegram.",
        },
      },

      definition: (url, workerId) => {
        return defineMethod({
          url,
          workerId,

          request: {
            schema: {
              update: typedJson<Update>(),
              user: TelegramUser.optional(),
            },

            resolve: { user: true },
          },

          response: {
            /**
             * Whether the update was handled successfully.
             *
             * Can also be set to `false` if the update was not relevant for the handler and should be passed to other handlers.
             */
            handled: z.boolean(),
          },
        })
      },
    },
  },
})
