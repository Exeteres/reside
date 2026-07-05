import type { CoreV1Api } from "@kubernetes/client-node"
import { decodeSecretValue } from "../mathesar"
import {
  MINIO_ADMIN_ENDPOINT_KEY,
  MINIO_ADMIN_PASSWORD_KEY,
  MINIO_ADMIN_SECRET_NAME,
  MINIO_ADMIN_USERNAME_KEY,
} from "./constants"

export type MinioAdminConfig = {
  endpoint: string
  username: string
  password: string
}

export async function loadMinioAdminConfig(
  coreApi: CoreV1Api,
  namespace: string,
): Promise<MinioAdminConfig> {
  const secret = await coreApi.readNamespacedSecret({
    name: MINIO_ADMIN_SECRET_NAME,
    namespace,
  })

  const username = decodeSecretValue(
    secret.data?.[MINIO_ADMIN_USERNAME_KEY],
    `Secret "${MINIO_ADMIN_SECRET_NAME}" is missing "${MINIO_ADMIN_USERNAME_KEY}"`,
  )
  const password = decodeSecretValue(
    secret.data?.[MINIO_ADMIN_PASSWORD_KEY],
    `Secret "${MINIO_ADMIN_SECRET_NAME}" is missing "${MINIO_ADMIN_PASSWORD_KEY}"`,
  )
  const endpoint = decodeSecretValue(
    secret.data?.[MINIO_ADMIN_ENDPOINT_KEY],
    `Secret "${MINIO_ADMIN_SECRET_NAME}" is missing "${MINIO_ADMIN_ENDPOINT_KEY}"`,
  )
  const parsedEndpoint = parseEndpoint(endpoint)

  return {
    endpoint: buildEndpoint(parsedEndpoint),
    username,
    password,
  }
}

function parseEndpoint(endpoint: string): URL {
  const parsedEndpoint = new URL(endpoint)

  if (!parsedEndpoint.hostname) {
    throw new Error(`Secret "${MINIO_ADMIN_SECRET_NAME}" has invalid endpoint value`)
  }

  if (parsedEndpoint.protocol !== "http:" && parsedEndpoint.protocol !== "https:") {
    throw new Error(`Secret "${MINIO_ADMIN_SECRET_NAME}" has unsupported endpoint protocol`)
  }

  return parsedEndpoint
}

function buildEndpoint(parsedEndpoint: URL): string {
  const port = getEndpointPort(parsedEndpoint)
  const portSuffix = port === undefined ? "" : `:${port}`

  return `${parsedEndpoint.protocol}//${parsedEndpoint.hostname}${portSuffix}`
}

function getEndpointPort(parsedEndpoint: URL): number | undefined {
  if (parsedEndpoint.port.length === 0) {
    return undefined
  }

  const port = Number.parseInt(parsedEndpoint.port, 10)

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Secret "${MINIO_ADMIN_SECRET_NAME}" has invalid endpoint port`)
  }

  return port
}
