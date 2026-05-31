import type { CoreV1Api, V1Secret } from "@kubernetes/client-node"
import { getStatusCode } from "@reside/utils"

export const TELEGRAM_SECRET_NAME = "telegram"
export const TELEGRAM_BOT_TOKEN_KEY = "bot_token"

export type TelegramSecretState = {
  resourceVersion: string | undefined
  botToken: string | undefined
}

/**
 * Loads the Telegram bot token from the replica secret.
 *
 * Missing secrets or missing token values are treated as an empty configuration.
 *
 * @param coreApi The Kubernetes core API client.
 * @param namespace The current replica namespace.
 * @returns The normalized Telegram secret state.
 */
export async function loadTelegramSecretState(
  coreApi: CoreV1Api,
  namespace: string,
): Promise<TelegramSecretState> {
  try {
    const secret = await coreApi.readNamespacedSecret({
      name: TELEGRAM_SECRET_NAME,
      namespace,
    })

    return {
      resourceVersion: secret.metadata?.resourceVersion,
      botToken: decodeSecretValue(secret, TELEGRAM_BOT_TOKEN_KEY),
    }
  } catch (error) {
    if (getStatusCode(error) === 404) {
      return {
        resourceVersion: undefined,
        botToken: undefined,
      }
    }

    throw error
  }
}

function decodeSecretValue(secret: V1Secret, key: string): string | undefined {
  const encodedValue = secret.data?.[key]
  if (!encodedValue || encodedValue.length === 0) {
    return undefined
  }

  return Buffer.from(encodedValue, "base64").toString("utf-8")
}
