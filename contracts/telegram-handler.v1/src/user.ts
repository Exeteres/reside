import type { User as UserInfo } from "grammy/types"
import { User } from "@contracts/user-manager.v1"
import { typedJson } from "@reside/shared"
import { co } from "jazz-tools"

export type TelegramUser = co.loaded<typeof TelegramUser>

export const TelegramUser = co.map({
  /**
   * The latest cached information about the Telegram user.
   */
  info: typedJson<UserInfo>(),

  /**
   * The user manager user associated with the Telegram user.
   */
  user: User,
})
