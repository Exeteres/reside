import type { Pool } from "pg"
import type { PrismaClient } from "../database"
import { createHash, randomBytes } from "node:crypto"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { AppsV1Api, CoreV1Api, CustomObjectsApi } from "@kubernetes/client-node"
import {
  bootstrapGatewayRoute,
  createAuthInterceptor,
  createPostgresPoolFromCredentials,
  getReplicaName,
  getReplicaNamespace,
  kubeConfig,
} from "@reside/common"
import { getStatusCode } from "@reside/utils"
import { Connection } from "@temporalio/client"
import {
  ensureAdminReplicaDatabase,
  ensureDatabaseRole,
  ensureGatewayRegistration,
  ensureTemporalNamespace,
  loadInfraGatewayConfig,
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
  upsertGatewayResources,
} from "../shared"
import { recoverPendingHelmRelease, runHelmCommand } from "./helm"

const TEMPORAL_GATEWAY_NAME = "temporal"
const TEMPORAL_WEB_SERVICE_NAME = "temporal-web"
const TEMPORAL_WEB_SERVICE_PORT = 8080
const TEMPORAL_AUTH_PROXY_DEPLOYMENT_NAME = "temporal-auth-proxy"
const TEMPORAL_AUTH_PROXY_SERVICE_NAME = "temporal-auth-proxy"
const TEMPORAL_AUTH_PROXY_PORT = 8080
const TEMPORAL_AUTH_SECRET_NAME = "temporal-web-auth"
const TEMPORAL_AUTH_USERNAME_KEY = "username"
const TEMPORAL_AUTH_PASSWORD_KEY = "password"
const TEMPORAL_AUTH_HTPASSWD_KEY = "htpasswd"
const TEMPORAL_AUTH_DEFAULT_USERNAME = "admin"
const TEMPORAL_AUTH_PROXY_CONFIG_MAP_NAME = "temporal-auth-proxy-config"
const TEMPORAL_AUTH_PROXY_CONFIG_FILE = "nginx.conf"
const TEMPORAL_AUTH_PROXY_IMAGE = "nginx:1.27-alpine"

/**
 * Ensures Temporal is bootstrapped in the current replica namespace.
 *
 * @returns Nothing.
 */
export async function ensureTemporalBootstrap(prisma: PrismaClient): Promise<void> {
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)
  const appsApi = kubeConfig.makeApiClient(AppsV1Api)
  const customObjectsApi = kubeConfig.makeApiClient(CustomObjectsApi)
  const namespace = getReplicaNamespace()
  const password = await ensureTemporalDatabaseSecret(coreApi, namespace)
  const adminConfig = await loadPostgresAdminConfig()
  const { pool } = createPostgresPoolFromCredentials(adminConfig)
  const valuesFilePath = await createHelmValuesFile(
    namespace,
    `${adminConfig.host}:${adminConfig.port}`,
  )

  try {
    await ensureTemporalDatabases(pool, password)
    await runHelmUpgrade(namespace, valuesFilePath)
    await restartTemporalDeployments(namespace)
    await ensureReplicaTemporalNamespace(namespace)
    await ensureTemporalAuthSecret(coreApi, namespace)
    const temporalAuthProxyConfig = buildTemporalAuthProxyConfig(namespace)
    const temporalAuthProxyConfigChecksum = sha256(temporalAuthProxyConfig)
    const temporalAuthSecretChecksum = await getTemporalAuthSecretChecksum(coreApi, namespace)

    await upsertTemporalAuthProxyConfigMap(coreApi, namespace, temporalAuthProxyConfig)
    await upsertTemporalAuthProxyService(coreApi, namespace)
    await upsertTemporalAuthProxyDeployment(appsApi, namespace, {
      configChecksum: temporalAuthProxyConfigChecksum,
      authSecretChecksum: temporalAuthSecretChecksum,
    })
    await waitForDeploymentReady(appsApi, namespace, TEMPORAL_AUTH_PROXY_DEPLOYMENT_NAME)

    const infraGatewayConfig = await loadInfraGatewayConfig(coreApi, namespace)
    const gateway = await ensureGatewayRegistration(prisma, {
      name: TEMPORAL_GATEWAY_NAME,
      ownerReplicaName: getReplicaName(),
      title: "Temporal",
      description: "Шлюз для панели управления Temporal",
    })

    await upsertGatewayResources(customObjectsApi, infraGatewayConfig, gateway)
    await bootstrapGatewayRoute({
      gatewayName: TEMPORAL_GATEWAY_NAME,
      endpoint: `${TEMPORAL_GATEWAY_NAME}.${infraGatewayConfig.clusterDomain}`,
      routeName: TEMPORAL_GATEWAY_NAME,
      paths: ["/"],
      backendServiceName: TEMPORAL_AUTH_PROXY_SERVICE_NAME,
      backendServicePort: TEMPORAL_AUTH_PROXY_PORT,
    })
  } finally {
    await rm(valuesFilePath, { force: true })
    await rm(dirname(valuesFilePath), { recursive: true, force: true })
  }
}

async function ensureTemporalAuthSecret(coreApi: CoreV1Api, namespace: string): Promise<void> {
  try {
    const secret = await coreApi.readNamespacedSecret({
      name: TEMPORAL_AUTH_SECRET_NAME,
      namespace,
    })

    const currentUsername = decodeSecretValue(secret.data?.[TEMPORAL_AUTH_USERNAME_KEY])
    const currentPassword = decodeSecretValue(secret.data?.[TEMPORAL_AUTH_PASSWORD_KEY])
    const currentHtpasswd = decodeSecretValue(secret.data?.[TEMPORAL_AUTH_HTPASSWD_KEY])

    if (currentUsername && currentPassword && currentHtpasswd) {
      return
    }

    const username = currentUsername ?? TEMPORAL_AUTH_DEFAULT_USERNAME
    const password = currentPassword ?? randomBytes(24).toString("base64url")
    const htpasswd = currentHtpasswd ?? `${username}:${await generateApr1Hash(password)}`

    await coreApi.replaceNamespacedSecret({
      name: TEMPORAL_AUTH_SECRET_NAME,
      namespace,
      body: {
        apiVersion: "v1",
        kind: "Secret",
        metadata: {
          name: TEMPORAL_AUTH_SECRET_NAME,
          namespace,
          resourceVersion: secret.metadata?.resourceVersion,
        },
        type: "Opaque",
        data: {
          ...(secret.data ?? {}),
          [TEMPORAL_AUTH_USERNAME_KEY]: encodeSecretValue(username),
          [TEMPORAL_AUTH_PASSWORD_KEY]: encodeSecretValue(password),
          [TEMPORAL_AUTH_HTPASSWD_KEY]: encodeSecretValue(htpasswd),
        },
      },
    })

    return
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  const username = TEMPORAL_AUTH_DEFAULT_USERNAME
  const password = randomBytes(24).toString("base64url")
  const htpasswd = `${username}:${await generateApr1Hash(password)}`

  await coreApi.createNamespacedSecret({
    namespace,
    body: {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: TEMPORAL_AUTH_SECRET_NAME,
        namespace,
      },
      type: "Opaque",
      data: {
        [TEMPORAL_AUTH_USERNAME_KEY]: encodeSecretValue(username),
        [TEMPORAL_AUTH_PASSWORD_KEY]: encodeSecretValue(password),
        [TEMPORAL_AUTH_HTPASSWD_KEY]: encodeSecretValue(htpasswd),
      },
    },
  })
}

async function upsertTemporalAuthProxyConfigMap(
  coreApi: CoreV1Api,
  namespace: string,
  config: string,
): Promise<void> {
  const body = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: TEMPORAL_AUTH_PROXY_CONFIG_MAP_NAME,
      namespace,
      labels: {
        "app.kubernetes.io/name": TEMPORAL_AUTH_PROXY_SERVICE_NAME,
      },
    },
    data: {
      [TEMPORAL_AUTH_PROXY_CONFIG_FILE]: config,
    },
  }

  try {
    await coreApi.readNamespacedConfigMap({
      name: TEMPORAL_AUTH_PROXY_CONFIG_MAP_NAME,
      namespace,
    })

    await coreApi.replaceNamespacedConfigMap({
      name: TEMPORAL_AUTH_PROXY_CONFIG_MAP_NAME,
      namespace,
      body,
    })

    return
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  await coreApi.createNamespacedConfigMap({
    namespace,
    body,
  })
}

async function upsertTemporalAuthProxyService(
  coreApi: CoreV1Api,
  namespace: string,
): Promise<void> {
  const body = {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: TEMPORAL_AUTH_PROXY_SERVICE_NAME,
      namespace,
      labels: {
        "app.kubernetes.io/name": TEMPORAL_AUTH_PROXY_SERVICE_NAME,
      },
    },
    spec: {
      type: "ClusterIP",
      selector: {
        "app.kubernetes.io/name": TEMPORAL_AUTH_PROXY_SERVICE_NAME,
      },
      ports: [
        {
          name: "http",
          port: TEMPORAL_AUTH_PROXY_PORT,
          targetPort: TEMPORAL_AUTH_PROXY_PORT,
        },
      ],
    },
  }

  try {
    await coreApi.readNamespacedService({
      name: TEMPORAL_AUTH_PROXY_SERVICE_NAME,
      namespace,
    })

    await coreApi.replaceNamespacedService({
      name: TEMPORAL_AUTH_PROXY_SERVICE_NAME,
      namespace,
      body,
    })

    return
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  await coreApi.createNamespacedService({
    namespace,
    body,
  })
}

async function upsertTemporalAuthProxyDeployment(
  appsApi: AppsV1Api,
  namespace: string,
  checksums: {
    configChecksum: string
    authSecretChecksum: string
  },
): Promise<void> {
  const body = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: TEMPORAL_AUTH_PROXY_DEPLOYMENT_NAME,
      namespace,
      labels: {
        "app.kubernetes.io/name": TEMPORAL_AUTH_PROXY_SERVICE_NAME,
      },
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {
          "app.kubernetes.io/name": TEMPORAL_AUTH_PROXY_SERVICE_NAME,
        },
      },
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/name": TEMPORAL_AUTH_PROXY_SERVICE_NAME,
          },
          annotations: {
            "reside.io/temporal-auth-proxy-config-sha": checksums.configChecksum,
            "reside.io/temporal-auth-secret-sha": checksums.authSecretChecksum,
          },
        },
        spec: {
          containers: [
            {
              name: "nginx",
              image: TEMPORAL_AUTH_PROXY_IMAGE,
              imagePullPolicy: "IfNotPresent",
              ports: [{ containerPort: TEMPORAL_AUTH_PROXY_PORT }],
              volumeMounts: [
                {
                  name: "config",
                  mountPath: `/etc/nginx/${TEMPORAL_AUTH_PROXY_CONFIG_FILE}`,
                  subPath: TEMPORAL_AUTH_PROXY_CONFIG_FILE,
                  readOnly: true,
                },
                {
                  name: "auth",
                  mountPath: "/etc/nginx/auth",
                  readOnly: true,
                },
              ],
              readinessProbe: {
                httpGet: {
                  path: "/healthz",
                  port: TEMPORAL_AUTH_PROXY_PORT,
                },
                initialDelaySeconds: 5,
                periodSeconds: 5,
              },
            },
          ],
          volumes: [
            {
              name: "config",
              configMap: {
                name: TEMPORAL_AUTH_PROXY_CONFIG_MAP_NAME,
              },
            },
            {
              name: "auth",
              secret: {
                secretName: TEMPORAL_AUTH_SECRET_NAME,
                items: [
                  {
                    key: TEMPORAL_AUTH_HTPASSWD_KEY,
                    path: "htpasswd",
                  },
                ],
              },
            },
          ],
        },
      },
    },
  }

  try {
    await appsApi.readNamespacedDeployment({
      name: TEMPORAL_AUTH_PROXY_DEPLOYMENT_NAME,
      namespace,
    })

    await appsApi.replaceNamespacedDeployment({
      name: TEMPORAL_AUTH_PROXY_DEPLOYMENT_NAME,
      namespace,
      body,
    })

    return
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  await appsApi.createNamespacedDeployment({
    namespace,
    body,
  })
}

async function getTemporalAuthSecretChecksum(
  coreApi: CoreV1Api,
  namespace: string,
): Promise<string> {
  const secret = await coreApi.readNamespacedSecret({
    name: TEMPORAL_AUTH_SECRET_NAME,
    namespace,
  })

  const username = decodeSecretValue(secret.data?.[TEMPORAL_AUTH_USERNAME_KEY]) ?? ""
  const password = decodeSecretValue(secret.data?.[TEMPORAL_AUTH_PASSWORD_KEY]) ?? ""
  const htpasswd = decodeSecretValue(secret.data?.[TEMPORAL_AUTH_HTPASSWD_KEY]) ?? ""

  return sha256(`${username}\n${password}\n${htpasswd}`)
}

async function waitForDeploymentReady(
  appsApi: AppsV1Api,
  namespace: string,
  name: string,
): Promise<void> {
  const attempts = 120

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const deployment = await appsApi.readNamespacedDeploymentStatus({
      name,
      namespace,
    })

    const availableReplicas = deployment.status?.availableReplicas ?? 0
    if (availableReplicas >= 1) {
      return
    }

    await Bun.sleep(5_000)
  }

  throw new Error(`Deployment "${name}" in namespace "${namespace}" did not become ready`)
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

async function createHelmValuesFile(namespace: string, postgresEndpoint: string): Promise<string> {
  const directoryPath = await mkdtemp(join(tmpdir(), "reside-database-temporal-"))
  const filePath = join(directoryPath, "values.yaml")
  const connectAddress = postgresEndpoint
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
      enabled: true,
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

function decodeSecretValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  return Buffer.from(value, "base64").toString("utf-8")
}

function buildTemporalAuthProxyConfig(namespace: string): string {
  return [
    "events {}",
    "",
    "http {",
    "  map $http_authorization $upstream_authorization {",
    '    ~*^Basic\\s+ "";',
    "    default $http_authorization;",
    "  }",
    "",
    "  server {",
    `    listen ${TEMPORAL_AUTH_PROXY_PORT};`,
    "",
    "    location = /healthz {",
    "      access_log off;",
    '      add_header Content-Type "text/plain";',
    '      return 200 "ok";',
    "    }",
    "",
    "    location / {",
    '      auth_basic "Temporal Dashboard";',
    "      auth_basic_user_file /etc/nginx/auth/htpasswd;",
    `      proxy_pass http://${TEMPORAL_WEB_SERVICE_NAME}.${namespace}.svc.cluster.local:${TEMPORAL_WEB_SERVICE_PORT};`,
    "      proxy_set_header Authorization $upstream_authorization;",
    "      proxy_set_header Host $host;",
    "      proxy_set_header X-Real-IP $remote_addr;",
    "      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "      proxy_set_header X-Forwarded-Proto $scheme;",
    "    }",
    "  }",
    "}",
    "",
  ].join("\n")
}

async function generateApr1Hash(password: string): Promise<string> {
  const processHandle = Bun.spawn(["openssl", "passwd", "-apr1", "-stdin"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })

  if (processHandle.stdin) {
    await processHandle.stdin.write(`${password}\n`)
    await processHandle.stdin.end()
  }

  const [exitCode, stdout, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ])
  if (exitCode !== 0) {
    throw new Error(`Failed to generate htpasswd hash: ${stderr.trim()}`)
  }

  const hash = stdout.trim()
  if (hash.length === 0) {
    throw new Error("Failed to generate htpasswd hash: empty output")
  }

  return hash
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
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
