import type { ResideCrypto } from "@reside/common/encryption"
import { z } from "zod"

export const TELEGRAM_BOT_TOKEN_SECRET_KEY = "telegram-bot-token"

const telegramBotTokenSecretSchema = z.object({
  value: z.string().min(1),
})

export type TelegramSecretState = {
  botToken: string | undefined
}

/**
 * Loads the Telegram bot token from Vault.
 *
 * Missing token values are treated as an empty configuration.
 *
 * @param crypto The configured encryption helper.
 * @returns The normalized Telegram secret state.
 */
export async function loadTelegramSecretState(crypto: ResideCrypto): Promise<TelegramSecretState> {
  const secret = await crypto.getSecret(telegramBotTokenSecretSchema, TELEGRAM_BOT_TOKEN_SECRET_KEY)

  return {
    botToken: secret.value.trim(),
  }
}
