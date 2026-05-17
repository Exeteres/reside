import type { PrismaClient } from "../database"
import { randomBytes } from "node:crypto"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { AppsV1Api, CoreV1Api, CustomObjectsApi } from "@kubernetes/client-node"
import {
  bootstrapGatewayRoute,
  getReplicaName,
  getReplicaNamespace,
  kubeConfig,
} from "@reside/common"
import {
  decodeSecretValue,
  encodeSecretValue,
  ensureGatewayRegistration,
  isNotFoundError,
  loadInfraGatewayConfig,
  MINIO_ADMIN_PASSWORD_KEY,
  MINIO_ADMIN_SECRET_NAME,
  MINIO_ADMIN_USERNAME_KEY,
  MINIO_CONSOLE_DEPLOYMENT_NAME,
  MINIO_CONSOLE_PBKDF_PASSPHRASE_KEY,
  MINIO_CONSOLE_PBKDF_SALT_KEY,
  MINIO_CONSOLE_SECRET_NAME,
  MINIO_CONSOLE_SERVICE_NAME,
  MINIO_CONSOLE_SERVICE_PORT,
  MINIO_RELEASE_NAME,
  MINIO_SERVICE_NAME,
  MINIO_SERVICE_PORT,
  upsertGatewayResources,
} from "../shared"
import { recoverPendingHelmRelease, runHelmCommand } from "./helm"

const MINIO_GATEWAY_NAME = "minio"
const STORAGE_GATEWAY_NAME = "storage"
const MINIO_CONSOLE_IMAGE = "ghcr.io/huncrys/minio-console:v1.8.1"

/**
 * Ensures MinIO and external MinIO Console are installed and exposed via gateways.
 */
export async function ensureMinioBootstrap(prisma: PrismaClient): Promise<void> {
  const namespace = getReplicaNamespace()
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)
  const appsApi = kubeConfig.makeApiClient(AppsV1Api)
  const customObjectsApi = kubeConfig.makeApiClient(CustomObjectsApi)

  await ensureMinioAdminSecret(coreApi, namespace)
  await ensureMinioConsoleSecret(coreApi, namespace)

  const valuesFilePath = await createMinioValuesFile()

  try {
    await runMinioHelmUpgrade(namespace, valuesFilePath)
  } finally {
    await rm(valuesFilePath, { force: true })
    await rm(dirname(valuesFilePath), { recursive: true, force: true })
  }

  await upsertMinioConsoleService(coreApi, namespace)
  await upsertMinioConsoleDeployment(appsApi, namespace)
  await waitForDeploymentReady(appsApi, namespace, MINIO_CONSOLE_DEPLOYMENT_NAME)

  const infraGatewayConfig = await loadInfraGatewayConfig(coreApi, namespace)
  const minioGateway = await ensureGatewayRegistration(prisma, {
    name: MINIO_GATEWAY_NAME,
    ownerReplicaName: getReplicaName(),
    title: "Хранилище MinIO",
    description: "Шлюз для панели управления MinIO",
  })
  const storageGateway = await ensureGatewayRegistration(prisma, {
    name: STORAGE_GATEWAY_NAME,
    ownerReplicaName: getReplicaName(),
    title: "S3 API",
    description: "Шлюз для S3 API MinIO",
  })

  await upsertGatewayResources(customObjectsApi, infraGatewayConfig, minioGateway)
  await upsertGatewayResources(customObjectsApi, infraGatewayConfig, storageGateway)

  await bootstrapGatewayRoute({
    gatewayName: MINIO_GATEWAY_NAME,
    routeName: MINIO_GATEWAY_NAME,
    paths: ["/"],
    backendServiceName: MINIO_CONSOLE_SERVICE_NAME,
    backendServicePort: MINIO_CONSOLE_SERVICE_PORT,
  })

  await bootstrapGatewayRoute({
    gatewayName: STORAGE_GATEWAY_NAME,
    routeName: STORAGE_GATEWAY_NAME,
    paths: ["/"],
    backendServiceName: MINIO_SERVICE_NAME,
    backendServicePort: MINIO_SERVICE_PORT,
  })
}

async function createMinioValuesFile(): Promise<string> {
  const directoryPath = await mkdtemp(join(tmpdir(), "reside-minio-"))
  const filePath = join(directoryPath, "values.yaml")

  const values = {
    fullnameOverride: MINIO_SERVICE_NAME,
    auth: {
      existingSecret: MINIO_ADMIN_SECRET_NAME,
      existingSecretUserKey: MINIO_ADMIN_USERNAME_KEY,
      existingSecretPasswordKey: MINIO_ADMIN_PASSWORD_KEY,
    },
    defaultBuckets: "",
    config: {
      browserEnabled: false,
    },
    service: {
      type: "ClusterIP",
      port: MINIO_SERVICE_PORT,
      consolePort: MINIO_CONSOLE_SERVICE_PORT,
    },
    persistence: {
      enabled: true,
      size: "20Gi",
    },
  }

  await writeFile(filePath, `${JSON.stringify(values, null, 2)}\n`)

  return filePath
}

async function runMinioHelmUpgrade(namespace: string, valuesFilePath: string): Promise<void> {
  await recoverPendingHelmRelease(namespace, MINIO_RELEASE_NAME)
  const chartPath = await resolveLocalChartArchive("minio")

  const command = [
    "helm",
    "upgrade",
    "--install",
    MINIO_RELEASE_NAME,
    chartPath,
    "--namespace",
    namespace,
    "--values",
    valuesFilePath,
    "--wait",
    "--timeout",
    "15m",
  ]

  const result = await runHelmCommand(command)
  if (result.exitCode !== 0) {
    throw new Error(`Helm upgrade failed with exit code ${result.exitCode}`)
  }
}

async function ensureMinioAdminSecret(
  coreApi: CoreV1Api,
  namespace: string,
): Promise<{ username: string; password: string }> {
  const generatedUsername = "admin"
  const generatedPassword = randomBytes(24).toString("base64url")

  try {
    const secret = await coreApi.readNamespacedSecret({
      name: MINIO_ADMIN_SECRET_NAME,
      namespace,
    })

    return {
      username: decodeSecretValue(
        secret.data?.[MINIO_ADMIN_USERNAME_KEY],
        `Secret "${MINIO_ADMIN_SECRET_NAME}" is missing "${MINIO_ADMIN_USERNAME_KEY}"`,
      ),
      password: decodeSecretValue(
        secret.data?.[MINIO_ADMIN_PASSWORD_KEY],
        `Secret "${MINIO_ADMIN_SECRET_NAME}" is missing "${MINIO_ADMIN_PASSWORD_KEY}"`,
      ),
    }
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
        name: MINIO_ADMIN_SECRET_NAME,
        namespace,
      },
      type: "Opaque",
      data: {
        [MINIO_ADMIN_USERNAME_KEY]: encodeSecretValue(generatedUsername),
        [MINIO_ADMIN_PASSWORD_KEY]: encodeSecretValue(generatedPassword),
      },
    },
  })

  return {
    username: generatedUsername,
    password: generatedPassword,
  }
}

async function ensureMinioConsoleSecret(
  coreApi: CoreV1Api,
  namespace: string,
): Promise<{ pbkdfPassphrase: string; pbkdfSalt: string }> {
  const generatedPbkdfPassphrase = randomBytes(24).toString("base64url")
  const generatedPbkdfSalt = randomBytes(24).toString("base64url")

  try {
    const secret = await coreApi.readNamespacedSecret({
      name: MINIO_CONSOLE_SECRET_NAME,
      namespace,
    })

    return {
      pbkdfPassphrase: decodeSecretValue(
        secret.data?.[MINIO_CONSOLE_PBKDF_PASSPHRASE_KEY],
        `Secret "${MINIO_CONSOLE_SECRET_NAME}" is missing "${MINIO_CONSOLE_PBKDF_PASSPHRASE_KEY}"`,
      ),
      pbkdfSalt: decodeSecretValue(
        secret.data?.[MINIO_CONSOLE_PBKDF_SALT_KEY],
        `Secret "${MINIO_CONSOLE_SECRET_NAME}" is missing "${MINIO_CONSOLE_PBKDF_SALT_KEY}"`,
      ),
    }
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
        name: MINIO_CONSOLE_SECRET_NAME,
        namespace,
      },
      type: "Opaque",
      data: {
        [MINIO_CONSOLE_PBKDF_PASSPHRASE_KEY]: encodeSecretValue(generatedPbkdfPassphrase),
        [MINIO_CONSOLE_PBKDF_SALT_KEY]: encodeSecretValue(generatedPbkdfSalt),
      },
    },
  })

  return {
    pbkdfPassphrase: generatedPbkdfPassphrase,
    pbkdfSalt: generatedPbkdfSalt,
  }
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

async function upsertMinioConsoleService(coreApi: CoreV1Api, namespace: string): Promise<void> {
  const body = {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: MINIO_CONSOLE_SERVICE_NAME,
      namespace,
      labels: {
        "app.kubernetes.io/name": MINIO_CONSOLE_SERVICE_NAME,
      },
    },
    spec: {
      type: "ClusterIP",
      selector: {
        "app.kubernetes.io/name": MINIO_CONSOLE_SERVICE_NAME,
      },
      ports: [
        {
          name: "http",
          port: MINIO_CONSOLE_SERVICE_PORT,
          targetPort: MINIO_CONSOLE_SERVICE_PORT,
        },
      ],
    },
  }

  try {
    await coreApi.readNamespacedService({
      name: MINIO_CONSOLE_SERVICE_NAME,
      namespace,
    })

    await coreApi.replaceNamespacedService({
      name: MINIO_CONSOLE_SERVICE_NAME,
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

async function upsertMinioConsoleDeployment(appsApi: AppsV1Api, namespace: string): Promise<void> {
  const body = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: MINIO_CONSOLE_DEPLOYMENT_NAME,
      namespace,
      labels: {
        "app.kubernetes.io/name": MINIO_CONSOLE_SERVICE_NAME,
      },
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {
          "app.kubernetes.io/name": MINIO_CONSOLE_SERVICE_NAME,
        },
      },
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/name": MINIO_CONSOLE_SERVICE_NAME,
          },
        },
        spec: {
          containers: [
            {
              name: "console",
              image: MINIO_CONSOLE_IMAGE,
              imagePullPolicy: "IfNotPresent",
              ports: [{ containerPort: MINIO_CONSOLE_SERVICE_PORT }],
              env: [
                {
                  name: "CONSOLE_MINIO_SERVER",
                  value: `http://${MINIO_SERVICE_NAME}.${namespace}.svc.cluster.local:${MINIO_SERVICE_PORT}`,
                },
                {
                  name: "CONSOLE_PBKDF_PASSPHRASE",
                  valueFrom: {
                    secretKeyRef: {
                      name: MINIO_CONSOLE_SECRET_NAME,
                      key: MINIO_CONSOLE_PBKDF_PASSPHRASE_KEY,
                    },
                  },
                },
                {
                  name: "CONSOLE_PBKDF_SALT",
                  valueFrom: {
                    secretKeyRef: {
                      name: MINIO_CONSOLE_SECRET_NAME,
                      key: MINIO_CONSOLE_PBKDF_SALT_KEY,
                    },
                  },
                },
              ],
              readinessProbe: {
                httpGet: {
                  path: "/",
                  port: MINIO_CONSOLE_SERVICE_PORT,
                },
                initialDelaySeconds: 10,
                periodSeconds: 5,
              },
            },
          ],
        },
      },
    },
  }

  try {
    await appsApi.readNamespacedDeployment({
      name: MINIO_CONSOLE_DEPLOYMENT_NAME,
      namespace,
    })

    await appsApi.replaceNamespacedDeployment({
      name: MINIO_CONSOLE_DEPLOYMENT_NAME,
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
