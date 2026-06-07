import type { ResideCrypto } from "@reside/common/encryption"

export const TELEGRAM_BOT_TOKEN_SECRET_KEY = "telegram-bot-token"

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
  return {
    botToken: (await crypto.getSecret(TELEGRAM_BOT_TOKEN_SECRET_KEY)).trim(),
  }
}
