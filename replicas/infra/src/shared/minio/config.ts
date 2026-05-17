import type { CoreV1Api } from "@kubernetes/client-node"
import { decodeSecretValue } from "../mathesar"
import {
  MINIO_ADMIN_PASSWORD_KEY,
  MINIO_ADMIN_SECRET_NAME,
  MINIO_ADMIN_USERNAME_KEY,
  MINIO_SERVICE_NAME,
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

  return {
    endpoint: `http://${MINIO_SERVICE_NAME}.${namespace}.svc.cluster.local:${MINIO_SERVICE_PORT}`,
    username,
    password,
  }
}
