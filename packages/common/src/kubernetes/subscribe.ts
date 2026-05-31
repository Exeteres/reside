import { CoreV1Api, type V1ConfigMap, type V1Secret } from "@kubernetes/client-node"
import { getStatusCode } from "@reside/utils"
import { getReplicaNamespace, kubeConfig } from "./shared"

const DEFAULT_POLL_INTERVAL_MS = 5_000

/**
 * Subscribes to decoded Secret updates in the current replica namespace.
 *
 * If the Secret already exists at subscription start, the decoded value is yielded immediately.
 * If the Secret does not exist yet, the first value is yielded as soon as it appears.
 *
 * @param name The Secret name.
 * @param pollInterval The polling interval in milliseconds.
 * @returns An async iterable of decoded Secret values.
 */
export async function* subscribeToSecret(
  name: string,
  pollInterval: number = DEFAULT_POLL_INTERVAL_MS,
): AsyncIterable<Record<string, string>> {
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)
  const namespace = getReplicaNamespace()
  let previousSignature: string | undefined

  while (true) {
    const secret = await readSecretIfExists(coreApi, namespace, name)
    if (secret) {
      const value = decodeSecretContent(secret)
      const signature = JSON.stringify(value)

      if (signature !== previousSignature) {
        previousSignature = signature
        yield value
      }
    }

    await Bun.sleep(pollInterval)
  }
}

/**
 * Subscribes to decoded ConfigMap updates in the current replica namespace.
 *
 * If the ConfigMap already exists at subscription start, the decoded value is yielded immediately.
 * If the ConfigMap does not exist yet, the first value is yielded as soon as it appears.
 *
 * @param name The ConfigMap name.
 * @param pollInterval The polling interval in milliseconds.
 * @returns An async iterable of decoded ConfigMap values.
 */
export async function* subscribeToConfigMap(
  name: string,
  pollInterval: number = DEFAULT_POLL_INTERVAL_MS,
): AsyncIterable<Record<string, string>> {
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)
  const namespace = getReplicaNamespace()
  let previousSignature: string | undefined

  while (true) {
    const configMap = await readConfigMapIfExists(coreApi, namespace, name)
    if (configMap) {
      const value = configMap.data ?? {}
      const signature = JSON.stringify(value)

      if (signature !== previousSignature) {
        previousSignature = signature
        yield value
      }
    }

    await Bun.sleep(pollInterval)
  }
}

async function readSecretIfExists(
  coreApi: CoreV1Api,
  namespace: string,
  name: string,
): Promise<V1Secret | null> {
  try {
    return await coreApi.readNamespacedSecret({
      name,
      namespace,
    })
  } catch (error) {
    if (getStatusCode(error) === 404) {
      return null
    }

    throw error
  }
}

async function readConfigMapIfExists(
  coreApi: CoreV1Api,
  namespace: string,
  name: string,
): Promise<V1ConfigMap | null> {
  try {
    return await coreApi.readNamespacedConfigMap({
      name,
      namespace,
    })
  } catch (error) {
    if (getStatusCode(error) === 404) {
      return null
    }

    throw error
  }
}

function decodeSecretContent(secret: V1Secret): Record<string, string> {
  const content: Record<string, string> = {}

  for (const [key, value] of Object.entries(secret.data ?? {})) {
    content[key] = Buffer.from(value, "base64").toString("utf-8")
  }

  return content
}
