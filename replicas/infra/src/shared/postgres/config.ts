import { CoreV1Api } from "@kubernetes/client-node"
import { getReplicaNamespace, kubeConfig } from "@reside/common"
import { getStatusCode } from "@reside/utils"
import {
  POSTGRES_ADMIN_DATABASE,
  POSTGRES_ADMIN_ENDPOINT_KEY,
  POSTGRES_ADMIN_PASSWORD_KEY,
  POSTGRES_ADMIN_SECRET_NAME,
  POSTGRES_ADMIN_USERNAME,
  POSTGRES_ADMIN_USERNAME_KEY,
  POSTGRES_SERVICE_PORT,
} from "./constants"

export type PostgresAdminConfig = {
  namespace: string
  host: string
  port: number
  endpoint: string
  username: string
  password: string
  database: string
}

/**
 * Builds a PostgreSQL connection string for the specified database.
 *
 * @param config Shared PostgreSQL admin configuration.
 * @param database The database name.
 * @returns PostgreSQL connection string.
 */
export function buildDatabaseConnectionString(
  config: PostgresAdminConfig,
  database: string,
): string {
  const username = encodeURIComponent(config.username)
  const password = encodeURIComponent(config.password)
  const databaseName = encodeURIComponent(database)

  return `postgresql://${username}:${password}@${config.host}:${config.port}/${databaseName}`
}

/**
 * Loads the shared PostgreSQL admin connection settings from Kubernetes.
 *
 * @returns Shared PostgreSQL admin configuration.
 */
export async function loadPostgresAdminConfig(): Promise<PostgresAdminConfig> {
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)
  const namespace = getReplicaNamespace()
  const secret = await readAdminSecret(coreApi, namespace)

  const endpoint = decodeSecretValue(
    secret.data?.[POSTGRES_ADMIN_ENDPOINT_KEY],
    `Secret "${POSTGRES_ADMIN_SECRET_NAME}" is missing "${POSTGRES_ADMIN_ENDPOINT_KEY}"`,
  )
  const parsedEndpoint = parsePostgresEndpoint(endpoint)

  const username = secret.data?.[POSTGRES_ADMIN_USERNAME_KEY]
    ? decodeSecretValue(
        secret.data[POSTGRES_ADMIN_USERNAME_KEY],
        `Secret "${POSTGRES_ADMIN_SECRET_NAME}" is missing "${POSTGRES_ADMIN_USERNAME_KEY}"`,
      )
    : POSTGRES_ADMIN_USERNAME
  const password = decodeSecretValue(secret.data?.[POSTGRES_ADMIN_PASSWORD_KEY])
  const host = parsedEndpoint.host
  const port = parsedEndpoint.port
  const database = POSTGRES_ADMIN_DATABASE

  return {
    namespace,
    host,
    port,
    endpoint,
    username,
    password,
    database,
  }
}

async function readAdminSecret(coreApi: CoreV1Api, namespace: string) {
  const attempts = 30

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await coreApi.readNamespacedSecret({
        name: POSTGRES_ADMIN_SECRET_NAME,
        namespace,
      })
    } catch (error) {
      if (!isNotFoundError(error) || attempt === attempts) {
        throw error
      }

      await Bun.sleep(1_000)
    }
  }

  throw new Error(`Secret "${POSTGRES_ADMIN_SECRET_NAME}" did not become available`)
}

function isNotFoundError(error: unknown): boolean {
  return getStatusCode(error) === 404
}

function decodeSecretValue(value: string | undefined, context?: string): string {
  if (!value) {
    throw new Error(
      context ?? `Secret "${POSTGRES_ADMIN_SECRET_NAME}" is missing required credentials`,
    )
  }

  return Buffer.from(value, "base64").toString("utf-8")
}

function parsePostgresEndpoint(endpoint: string): { host: string; port: number } {
  const normalizedEndpoint = endpoint.includes("://") ? endpoint : `postgresql://${endpoint}`
  const parsedEndpoint = new URL(normalizedEndpoint)

  if (!parsedEndpoint.hostname) {
    throw new Error(`Secret "${POSTGRES_ADMIN_SECRET_NAME}" has invalid endpoint value`)
  }

  const parsedPort =
    parsedEndpoint.port.length > 0
      ? Number.parseInt(parsedEndpoint.port, 10)
      : POSTGRES_SERVICE_PORT

  if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
    throw new Error(`Secret "${POSTGRES_ADMIN_SECRET_NAME}" has invalid endpoint port`)
  }

  return {
    host: parsedEndpoint.hostname,
    port: parsedPort,
  }
}
