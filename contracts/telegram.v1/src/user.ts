import type { TelegramData } from "./contract"
import { TelegramUser } from "@contracts/telegram-handler.v1"
import { loadBoxed } from "@reside/shared"

/**
 * Finds the Telegram user by their Telegram ID.
 *
 * @param data The Telegram contract data.
 * @param id The Telegram user ID.
 * @returns The loaded Telegram user, or `null` if not found.
 */
export async function getTelegramUserById(
  data: TelegramData,
  id: number,
): Promise<TelegramUser | null> {
  return await loadBoxed(
    TelegramUser,
    `user.by-id.${id}`,
    data.$jazz.owner.$jazz.id,
    data.$jazz.loadedAs,
  )
}

/**
 * Finds the Telegram user by their username.
 *
 * @param data The Telegram contract data.
 * @param username The Telegram username.
 * @returns The loaded Telegram user, or `null` if not found.
 */
export async function getTelegramUserByUsername(
  data: TelegramData,
  username: string,
): Promise<TelegramUser | null> {
  return await loadBoxed(
    TelegramUser,
    `user.by-username.${username.toLowerCase()}`,
    data.$jazz.owner.$jazz.id,
    data.$jazz.loadedAs,
  )
}
