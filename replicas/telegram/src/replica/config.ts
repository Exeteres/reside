import type { CoreV1Api, V1ConfigMap } from "@kubernetes/client-node"
import { getStatusCode } from "@reside/utils"

export const TELEGRAM_CONFIG_MAP_NAME = "telegram"
export const TELEGRAM_SYSTEM_CHAT_ID_KEY = "system_chat_id"
export const TELEGRAM_SUPER_ADMIN_USER_ID_KEY = "super_admin_user_id"

export type TelegramConfigState = {
  resourceVersion: string | undefined
  systemChatId: string | undefined
  superAdminUserId: string | undefined
}

/**
 * Loads Telegram runtime config from the replica ConfigMap.
 *
 * Missing ConfigMap or missing values are treated as an empty configuration.
 *
 * @param coreApi The Kubernetes core API client.
 * @param namespace The current replica namespace.
 * @returns The normalized Telegram config state.
 */
export async function loadTelegramConfigState(
  coreApi: CoreV1Api,
  namespace: string,
): Promise<TelegramConfigState> {
  try {
    const configMap = await coreApi.readNamespacedConfigMap({
      name: TELEGRAM_CONFIG_MAP_NAME,
      namespace,
    })

    return {
      resourceVersion: configMap.metadata?.resourceVersion,
      systemChatId: getConfigValue(configMap, TELEGRAM_SYSTEM_CHAT_ID_KEY),
      superAdminUserId: getConfigValue(configMap, TELEGRAM_SUPER_ADMIN_USER_ID_KEY),
    }
  } catch (error) {
    if (getStatusCode(error) === 404) {
      return {
        resourceVersion: undefined,
        systemChatId: undefined,
        superAdminUserId: undefined,
      }
    }

    throw error
  }
}

function getConfigValue(configMap: V1ConfigMap, key: string): string | undefined {
  const value = configMap.data?.[key]?.trim()
  if (!value) {
    return undefined
  }

  return value
}
