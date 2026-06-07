import type { CoreV1Api, V1ConfigMap } from "@kubernetes/client-node"

const VAULT_CONFIG_MAP_NAME = "vault"
const VAULT_ENDPOINT_KEY = "endpoint"
const VAULT_AUDIENCE_KEY = "audience"

export type VaultConfig = {
  endpoint: string
  audience: string
}

export async function loadVaultConfig(coreApi: CoreV1Api, namespace: string): Promise<VaultConfig> {
  const configMap = await coreApi.readNamespacedConfigMap({
    name: VAULT_CONFIG_MAP_NAME,
    namespace,
  })

  return {
    endpoint: getRequiredConfigValue(configMap, VAULT_ENDPOINT_KEY),
    audience: getRequiredConfigValue(configMap, VAULT_AUDIENCE_KEY),
  }
}

function getRequiredConfigValue(configMap: V1ConfigMap, key: string): string {
  const value = configMap.data?.[key]?.trim()
  if (!value) {
    const configMapName = configMap.metadata?.name ?? VAULT_CONFIG_MAP_NAME
    throw new Error(`ConfigMap "${configMapName}" must contain "${key}"`)
  }

  return value
}
