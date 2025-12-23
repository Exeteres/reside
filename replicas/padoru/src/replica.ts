import { TelegramContract } from "@contracts/telegram.v1"
import { TelegramHandlerContract } from "@contracts/telegram-handler.v1"
import { defineReplica } from "@reside/shared"
import { PadoruRoot } from "./config"
import { handler } from "./handler"

export const PadoruReplica = defineReplica({
  identity: "ghcr.io/exeteres/reside/replicas/padoru",

  privateData: PadoruRoot,

  info: {
    name: "padoru",
    class: "long-running",
    exclusive: false,
    scalable: true,
  },

  displayInfo: {
    ru: {
      title: "ПАДОРУ РЕПЛИКА",
      description: "HASHIRE SORI YO; KAZE NO YOU NI; TSKIMIHARA WO; PADORU PADORU",
    },
    en: {
      title: "PADORU REPLICA",
      description: "HASHIRE SORI YO; KAZE NO YOU NI; TSKIMIHARA WO; PADORU PADORU",
    },
  },

  requirements: {
    telegram: {
      contract: TelegramContract,
      permissions: [handler.permission],
    },
  },

  implementations: {
    telegramHandler: TelegramHandlerContract,
  },
})
