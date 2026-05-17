import type { Pool } from "pg"
import type { PrismaClient } from "../database"
import { randomBytes } from "node:crypto"
import { AppsV1Api, CoreV1Api, CustomObjectsApi } from "@kubernetes/client-node"
import {
  bootstrapGatewayRoute,
  getReplicaName,
  getReplicaNamespace,
  kubeConfig,
} from "@reside/common"
import { getStatusCode } from "@reside/utils"
import {
  buildMathesarBaseUrl,
  buildReplicaDatabaseName,
  completeMathesarInstallation,
  connectMathesarDatabaseAsAdmin,
  decodeSecretValue,
  encodeSecretValue,
  ensureAdminReplicaDatabase,
  ensureDatabaseRole,
  ensureGatewayRegistration,
  isNotFoundError,
  loadInfraGatewayConfig,
  loadMathesarAdminCredentials,
  loadPostgresAdminConfig,
  MATHESAR_DATABASE_SECRET_NAME,
  POSTGRES_SERVICE_NAME,
  upsertGatewayResources,
} from "../shared"

const DATABASE_GATEWAY_NAME = "database"
const MATHESAR_DATABASE_NAME = "mathesar_django"
const MATHESAR_DATABASE_USERNAME = "mathesar"
const MATHESAR_DATABASE_PASSWORD_KEY = "POSTGRES_PASSWORD"
const MATHESAR_SECRET_KEY = "SECRET_KEY"
const MATHESAR_ADMIN_PASSWORD_KEY = "MATHESAR_ADMIN_PASSWORD"
const MATHESAR_DEPLOYMENT_NAME = "mathesar"
const MATHESAR_SERVICE_NAME = "mathesar"
const MATHESAR_SERVICE_PORT = 80
const MATHESAR_CONTAINER_PORT = 8000

/**
 * Ensures Mathesar is deployed and exposed behind the infra database gateway.
 */
export async function ensureMathesarBootstrap(
  adminPool: Pool,
  prisma: PrismaClient,
): Promise<void> {
  const namespace = getReplicaNamespace()
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)
  const appsApi = kubeConfig.makeApiClient(AppsV1Api)
  const customObjectsApi = kubeConfig.makeApiClient(CustomObjectsApi)
  const infraGatewayConfig = await loadInfraGatewayConfig(coreApi, namespace)

  const databasePassword = await ensureMathesarSecret(coreApi, namespace)
  const adminCredentials = await loadMathesarAdminCredentials(coreApi, namespace)
  const adminConfig = await loadPostgresAdminConfig()
  const replicaDatabase = buildReplicaDatabaseName(namespace)

  await ensureDatabaseRole(adminPool, MATHESAR_DATABASE_USERNAME, databasePassword)
  await ensureAdminReplicaDatabase(adminPool, MATHESAR_DATABASE_NAME, MATHESAR_DATABASE_USERNAME)

  await upsertMathesarService(coreApi, namespace)
  await upsertMathesarDeployment(appsApi, namespace)
  await waitForDeploymentReady(appsApi, namespace, MATHESAR_DEPLOYMENT_NAME)
  await completeMathesarInstallation({
    baseUrl: buildMathesarBaseUrl(namespace),
    username: adminCredentials.username,
    password: adminCredentials.password,
  })
  await connectMathesarDatabaseAsAdmin({
    baseUrl: buildMathesarBaseUrl(namespace),
    username: adminCredentials.username,
    password: adminCredentials.password,
    database: {
      id: `infra:${replicaDatabase}`,
      database: replicaDatabase,
    },
    adminConfig,
  })

  const gateway = await ensureGatewayRegistration(prisma, {
    name: DATABASE_GATEWAY_NAME,
    ownerReplicaName: getReplicaName(),
    title: "База данных",
    description: "Шлюз для панели управления базами данных",
  })

  await upsertGatewayResources(customObjectsApi, infraGatewayConfig, gateway)

  await bootstrapGatewayRoute({
    gatewayName: DATABASE_GATEWAY_NAME,
    routeName: DATABASE_GATEWAY_NAME,
    paths: ["/"],
    backendServiceName: MATHESAR_SERVICE_NAME,
    backendServicePort: MATHESAR_SERVICE_PORT,
  })
}

async function ensureMathesarSecret(coreApi: CoreV1Api, namespace: string): Promise<string> {
  const generatedSecretKey = randomBytes(50).toString("base64url")
  const generatedDatabasePassword = randomBytes(24).toString("base64url")
  const generatedAdminPassword = randomBytes(24).toString("base64url")

  try {
    const secret = await coreApi.readNamespacedSecret({
      name: MATHESAR_DATABASE_SECRET_NAME,
      namespace,
    })

    const databasePassword = decodeSecretValue(
      secret.data?.[MATHESAR_DATABASE_PASSWORD_KEY],
      `Secret "${MATHESAR_DATABASE_SECRET_NAME}" is missing "${MATHESAR_DATABASE_PASSWORD_KEY}"`,
    )
    const secretKey = secret.data?.[MATHESAR_SECRET_KEY]
      ? decodeSecretValue(
          secret.data[MATHESAR_SECRET_KEY],
          `Secret "${MATHESAR_DATABASE_SECRET_NAME}" is missing "${MATHESAR_SECRET_KEY}"`,
        )
      : generatedSecretKey
    const adminPassword = secret.data?.[MATHESAR_ADMIN_PASSWORD_KEY]
      ? decodeSecretValue(
          secret.data[MATHESAR_ADMIN_PASSWORD_KEY],
          `Secret "${MATHESAR_DATABASE_SECRET_NAME}" is missing "${MATHESAR_ADMIN_PASSWORD_KEY}"`,
        )
      : generatedAdminPassword

    const shouldReplaceSecret =
      !secret.data?.[MATHESAR_SECRET_KEY] || !secret.data?.[MATHESAR_ADMIN_PASSWORD_KEY]

    if (shouldReplaceSecret) {
      await coreApi.replaceNamespacedSecret({
        name: MATHESAR_DATABASE_SECRET_NAME,
        namespace,
        body: {
          apiVersion: "v1",
          kind: "Secret",
          metadata: {
            name: MATHESAR_DATABASE_SECRET_NAME,
            namespace,
            resourceVersion: secret.metadata?.resourceVersion,
          },
          type: "Opaque",
          data: {
            ...(secret.data ?? {}),
            [MATHESAR_DATABASE_PASSWORD_KEY]: encodeSecretValue(databasePassword),
            [MATHESAR_SECRET_KEY]: encodeSecretValue(secretKey),
            [MATHESAR_ADMIN_PASSWORD_KEY]: encodeSecretValue(adminPassword),
          },
        },
      })
    }

    return databasePassword
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  await coreApi.createNamespacedSecret({
    namespace,
    body: {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: MATHESAR_DATABASE_SECRET_NAME,
        namespace,
      },
      type: "Opaque",
      data: {
        [MATHESAR_DATABASE_PASSWORD_KEY]: encodeSecretValue(generatedDatabasePassword),
        [MATHESAR_SECRET_KEY]: encodeSecretValue(generatedSecretKey),
        [MATHESAR_ADMIN_PASSWORD_KEY]: encodeSecretValue(generatedAdminPassword),
      },
    },
  })

  return generatedDatabasePassword
}

async function upsertMathesarService(coreApi: CoreV1Api, namespace: string): Promise<void> {
  const body = {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: MATHESAR_SERVICE_NAME,
      namespace,
      labels: {
        "app.kubernetes.io/name": MATHESAR_SERVICE_NAME,
      },
    },
    spec: {
      type: "ClusterIP",
      selector: {
        "app.kubernetes.io/name": MATHESAR_SERVICE_NAME,
      },
      ports: [
        {
          name: "http",
          port: MATHESAR_SERVICE_PORT,
          targetPort: MATHESAR_CONTAINER_PORT,
        },
      ],
    },
  }

  try {
    await coreApi.readNamespacedService({
      name: MATHESAR_SERVICE_NAME,
      namespace,
    })

    await coreApi.replaceNamespacedService({
      name: MATHESAR_SERVICE_NAME,
      namespace,
      body,
    })

    return
  } catch (error) {
    if (getStatusCode(error) !== 404) {
      throw error
    }
  }

  await coreApi.createNamespacedService({
    namespace,
    body,
  })
}

async function upsertMathesarDeployment(appsApi: AppsV1Api, namespace: string): Promise<void> {
  const host = `${POSTGRES_SERVICE_NAME}.${namespace}.svc.cluster.local`
  const clusterDomain = process.env.RESIDE_CLUSTER_DOMAIN?.trim()
  const domainName =
    clusterDomain && clusterDomain.length > 0
      ? `http://${DATABASE_GATEWAY_NAME}.${clusterDomain}`
      : `http://${DATABASE_GATEWAY_NAME}`

  const body = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: MATHESAR_DEPLOYMENT_NAME,
      namespace,
      labels: {
        "app.kubernetes.io/name": MATHESAR_SERVICE_NAME,
      },
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {
          "app.kubernetes.io/name": MATHESAR_SERVICE_NAME,
        },
      },
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/name": MATHESAR_SERVICE_NAME,
          },
        },
        spec: {
          containers: [
            {
              name: "mathesar",
              image: "mathesar/mathesar:latest",
              imagePullPolicy: "Always",
              ports: [{ containerPort: MATHESAR_CONTAINER_PORT }],
              env: [
                {
                  name: "DOMAIN_NAME",
                  value: domainName,
                },
                {
                  name: "POSTGRES_DB",
                  value: MATHESAR_DATABASE_NAME,
                },
                {
                  name: "POSTGRES_USER",
                  value: MATHESAR_DATABASE_USERNAME,
                },
                {
                  name: "POSTGRES_HOST",
                  value: host,
                },
                {
                  name: "POSTGRES_PORT",
                  value: "5432",
                },
                {
                  name: "DJANGO_SETTINGS_MODULE",
                  value: "config.settings.production",
                },
                {
                  name: "ALLOWED_HOSTS",
                  value: "*",
                },
                {
                  name: "DEBUG",
                  value: "false",
                },
                {
                  name: "WEB_CONCURRENCY",
                  value: "3",
                },
                {
                  name: MATHESAR_DATABASE_PASSWORD_KEY,
                  valueFrom: {
                    secretKeyRef: {
                      name: MATHESAR_DATABASE_SECRET_NAME,
                      key: MATHESAR_DATABASE_PASSWORD_KEY,
                    },
                  },
                },
                {
                  name: MATHESAR_SECRET_KEY,
                  valueFrom: {
                    secretKeyRef: {
                      name: MATHESAR_DATABASE_SECRET_NAME,
                      key: MATHESAR_SECRET_KEY,
                    },
                  },
                },
              ],
              readinessProbe: {
                tcpSocket: {
                  port: MATHESAR_CONTAINER_PORT,
                },
                periodSeconds: 10,
                timeoutSeconds: 3,
                failureThreshold: 12,
              },
              livenessProbe: {
                tcpSocket: {
                  port: MATHESAR_CONTAINER_PORT,
                },
                initialDelaySeconds: 30,
                periodSeconds: 20,
                timeoutSeconds: 3,
                failureThreshold: 6,
              },
            },
          ],
        },
      },
    },
  }

  try {
    await appsApi.readNamespacedDeployment({
      name: MATHESAR_DEPLOYMENT_NAME,
      namespace,
    })

    await appsApi.replaceNamespacedDeployment({
      name: MATHESAR_DEPLOYMENT_NAME,
      namespace,
      body,
    })

    return
  } catch (error) {
    if (getStatusCode(error) !== 404) {
      throw error
    }
  }

  await appsApi.createNamespacedDeployment({
    namespace,
    body,
  })
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

    const desiredReplicas = deployment.spec?.replicas ?? 1
    const readyReplicas = deployment.status?.readyReplicas ?? 0
    const availableReplicas = deployment.status?.availableReplicas ?? 0

    if (readyReplicas >= desiredReplicas && availableReplicas >= desiredReplicas) {
      return
    }

    await Bun.sleep(5_000)
  }

  throw new Error(`Deployment "${name}" in namespace "${namespace}" did not become ready`)
}
