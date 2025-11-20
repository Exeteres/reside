import type { TelegramUser } from "@contracts/telegram-handler.v1"
import type { Update, UserFromGetMe } from "grammy/types"
import { type Api, Context } from "grammy"

export class ResideTelegramContext extends Context {
  constructor(
    update: Update,
    api: Api,
    me: UserFromGetMe,

    /**
     * The telegram user associated with the current context.
     *
     * Will be `undefined` if the update does not have a `from` field.
     */
    readonly user: TelegramUser | undefined,
  ) {
    super(update, api, me)
  }
}
