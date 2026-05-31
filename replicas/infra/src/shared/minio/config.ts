import type { CoreV1Api } from "@kubernetes/client-node"
import { decodeSecretValue } from "../mathesar"
import {
  MINIO_ADMIN_ENDPOINT_KEY,
  MINIO_ADMIN_PASSWORD_KEY,
  MINIO_ADMIN_SECRET_NAME,
  MINIO_ADMIN_USERNAME_KEY,
  MINIO_SERVICE_PORT,
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
  const normalizedEndpoint = normalizeEndpoint(endpoint)

  return {
    endpoint: normalizedEndpoint,
    username,
    password,
  }
}

function normalizeEndpoint(endpoint: string): string {
  const normalizedEndpoint = endpoint.includes("://") ? endpoint : `http://${endpoint}`
  const parsedEndpoint = new URL(normalizedEndpoint)

  if (!parsedEndpoint.hostname) {
    throw new Error(`Secret "${MINIO_ADMIN_SECRET_NAME}" has invalid endpoint value`)
  }

  const port =
    parsedEndpoint.port.length > 0 ? Number.parseInt(parsedEndpoint.port, 10) : MINIO_SERVICE_PORT

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Secret "${MINIO_ADMIN_SECRET_NAME}" has invalid endpoint port`)
  }

  return `${parsedEndpoint.hostname}:${port}`
}
