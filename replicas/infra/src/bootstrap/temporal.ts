import type { Pool } from "pg"
import { randomBytes } from "node:crypto"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { CoreV1Api } from "@kubernetes/client-node"
import {
  createAuthInterceptor,
  createPostgresPoolFromCredentials,
  getReplicaNamespace,
  kubeConfig,
} from "@reside/common"
import { getStatusCode } from "@reside/utils"
import { Connection } from "@temporalio/client"
import {
  ensureAdminReplicaDatabase,
  ensureDatabaseRole,
  ensureTemporalNamespace,
  loadPostgresAdminConfig,
  TEMPORAL_DATABASE_PASSWORD_KEY,
  TEMPORAL_DATABASE_SECRET_NAME,
  TEMPORAL_DATABASE_USERNAME,
  TEMPORAL_DEFAULT_DATABASE,
  TEMPORAL_FRONTEND_PORT,
  TEMPORAL_FRONTEND_SERVICE_NAME,
  TEMPORAL_RELEASE_NAME,
  TEMPORAL_SERVER_IMAGE_REPOSITORY,
  TEMPORAL_SERVER_IMAGE_TAG,
  TEMPORAL_VISIBILITY_DATABASE,
} from "../shared"
import { recoverPendingHelmRelease, runHelmCommand } from "./helm"

/**
 * Ensures Temporal is bootstrapped in the current replica namespace.
 *
 * @returns Nothing.
 */
export async function ensureTemporalBootstrap(): Promise<void> {
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)
  const namespace = getReplicaNamespace()
  const password = await ensureTemporalDatabaseSecret(coreApi, namespace)
  const adminConfig = await loadPostgresAdminConfig()
  const { pool } = createPostgresPoolFromCredentials(adminConfig)
  const valuesFilePath = await createHelmValuesFile(namespace)

  try {
    await ensureTemporalDatabases(pool, password)
    await runHelmUpgrade(namespace, valuesFilePath)
    await restartTemporalDeployments(namespace)
    await ensureReplicaTemporalNamespace(namespace)
  } finally {
    await rm(valuesFilePath, { force: true })
    await rm(dirname(valuesFilePath), { recursive: true, force: true })
  }
}

async function ensureTemporalDatabaseSecret(
  coreApi: CoreV1Api,
  namespace: string,
): Promise<string | null> {
  try {
    await coreApi.readNamespacedSecret({
      name: TEMPORAL_DATABASE_SECRET_NAME,
      namespace,
    })

    return null
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  const password = randomBytes(24).toString("base64url")
  await coreApi.createNamespacedSecret({
    namespace,
    body: {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: TEMPORAL_DATABASE_SECRET_NAME,
        namespace,
      },
      type: "Opaque",
      data: {
        [TEMPORAL_DATABASE_PASSWORD_KEY]: encodeSecretValue(password),
      },
    },
  })

  return password
}

async function ensureTemporalDatabases(adminPool: Pool, password: string | null): Promise<void> {
  if (password !== null) {
    await ensureDatabaseRole(adminPool, TEMPORAL_DATABASE_USERNAME, password)
  }

  await ensureAdminReplicaDatabase(adminPool, TEMPORAL_DEFAULT_DATABASE, TEMPORAL_DATABASE_USERNAME)
  await ensureAdminReplicaDatabase(
    adminPool,
    TEMPORAL_VISIBILITY_DATABASE,
    TEMPORAL_DATABASE_USERNAME,
  )
}

async function createHelmValuesFile(namespace: string): Promise<string> {
  const directoryPath = await mkdtemp(join(tmpdir(), "reside-database-temporal-"))
  const filePath = join(directoryPath, "values.yaml")
  const connectAddress = `postgres.${namespace}.svc.cluster.local:5432`
  const audience = `${TEMPORAL_FRONTEND_SERVICE_NAME}.${namespace}.svc.cluster.local`

  const values = {
    server: {
      additionalEnv: [
        {
          name: "AUDIENCE",
          value: audience,
        },
      ],
      config: {
        persistence: {
          defaultStore: "default",
          visibilityStore: "visibility",
          numHistoryShards: 512,
          datastores: {
            default: {
              sql: {
                createDatabase: false,
                manageSchema: true,
                pluginName: "postgres12",
                driverName: "postgres12",
                connectProtocol: "tcp",
                databaseName: TEMPORAL_DEFAULT_DATABASE,
                connectAddr: connectAddress,
                user: TEMPORAL_DATABASE_USERNAME,
                existingSecret: TEMPORAL_DATABASE_SECRET_NAME,
                secretKey: TEMPORAL_DATABASE_PASSWORD_KEY,
              },
            },
            visibility: {
              sql: {
                createDatabase: false,
                manageSchema: true,
                pluginName: "postgres12",
                driverName: "postgres12",
                connectProtocol: "tcp",
                databaseName: TEMPORAL_VISIBILITY_DATABASE,
                connectAddr: connectAddress,
                user: TEMPORAL_DATABASE_USERNAME,
                existingSecret: TEMPORAL_DATABASE_SECRET_NAME,
                secretKey: TEMPORAL_DATABASE_PASSWORD_KEY,
              },
            },
          },
        },
      },
      image: {
        repository: TEMPORAL_SERVER_IMAGE_REPOSITORY,
        tag: TEMPORAL_SERVER_IMAGE_TAG,
        pullPolicy: "Always",
      },
    },
    schema: {
      setup: {
        enabled: true,
      },
      update: {
        enabled: true,
      },
    },
    elasticsearch: {
      enabled: false,
    },
    prometheus: {
      enabled: false,
    },
    grafana: {
      enabled: false,
    },
    web: {
      enabled: false,
    },
    admintools: {
      enabled: false,
    },
    cassandra: {
      enabled: false,
    },
    mysql: {
      enabled: false,
    },
    postgresql: {
      enabled: false,
    },
  }

  await writeFile(filePath, `${JSON.stringify(values, null, 2)}\n`)

  return filePath
}

async function runHelmUpgrade(namespace: string, valuesFilePath: string): Promise<void> {
  await recoverPendingHelmRelease(namespace, TEMPORAL_RELEASE_NAME, "uninstall")
  const chartPath = await resolveLocalChartArchive("temporal")

  const command = [
    "helm",
    "upgrade",
    "--install",
    TEMPORAL_RELEASE_NAME,
    chartPath,
    "--namespace",
    namespace,
    "--values",
    valuesFilePath,
    "--wait",
    "--timeout",
    "10m",
  ]

  const result = await runHelmCommand(command)
  if (result.exitCode !== 0) {
    throw new Error(`Helm upgrade failed with exit code ${result.exitCode}`)
  }
}

async function restartTemporalDeployments(namespace: string): Promise<void> {
  const deploymentNames = [
    "temporal-frontend",
    "temporal-history",
    "temporal-matching",
    "temporal-worker",
  ]

  const restartResult = await runKubectlCommand([
    "kubectl",
    "-n",
    namespace,
    "rollout",
    "restart",
    "deployment",
    ...deploymentNames,
  ])
  if (restartResult.exitCode !== 0) {
    throw new Error(`kubectl rollout restart failed with exit code ${restartResult.exitCode}`)
  }

  for (const deploymentName of deploymentNames) {
    const statusResult = await runKubectlCommand([
      "kubectl",
      "-n",
      namespace,
      "rollout",
      "status",
      `deployment/${deploymentName}`,
      "--timeout=5m",
    ])
    if (statusResult.exitCode !== 0) {
      throw new Error(
        `kubectl rollout status failed for deployment "${deploymentName}" with exit code ${statusResult.exitCode}`,
      )
    }
  }
}

async function runKubectlCommand(command: string[]): Promise<{ exitCode: number }> {
  const processHandle = Bun.spawn(command, {
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  })

  return {
    exitCode: await processHandle.exited,
  }
}

async function ensureReplicaTemporalNamespace(namespace: string): Promise<void> {
  const address = `${TEMPORAL_FRONTEND_SERVICE_NAME}.${namespace}.svc.cluster.local:${TEMPORAL_FRONTEND_PORT}`
  const connection = await Connection.connect({
    address,
    interceptors: [createAuthInterceptor(address)],
  })

  await ensureTemporalNamespace(connection.workflowService, namespace)
}

function encodeSecretValue(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64")
}

async function resolveLocalChartArchive(name: string): Promise<string> {
  const chartsDirectory = join(process.cwd(), "assets", "charts")
  const files = await readdir(chartsDirectory)
  const archiveName = files.find(file => file.startsWith(`${name}-`) && file.endsWith(".tgz"))

  if (!archiveName) {
    throw new Error(`Helm chart archive for "${name}" was not found in ${chartsDirectory}`)
  }

  return join(chartsDirectory, archiveName)
}

function isNotFoundError(error: unknown): boolean {
  return getStatusCode(error) === 404
}
