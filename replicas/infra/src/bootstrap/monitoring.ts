import type { Pool } from "pg"
import type { PrismaClient } from "../database"
import { randomBytes } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { CoreV1Api, CustomObjectsApi } from "@kubernetes/client-node"
import {
  bootstrapGatewayRoute,
  getReplicaName,
  getReplicaNamespace,
  kubeConfig,
} from "@reside/common"
import {
  buildDatabaseConnectionString,
  decodeSecretValue,
  encodeSecretValue,
  ensureAdminReplicaDatabase,
  ensureDatabaseRole,
  ensureGatewayRegistration,
  isNotFoundError,
  loadInfraGatewayConfig,
  loadPostgresAdminConfig,
  upsertGatewayResources,
} from "../shared"
import { recoverPendingHelmRelease, runHelmCommand } from "./helm"

const MONITORING_GATEWAY_NAME = "monitoring"
const SIGNOZ_RELEASE_NAME = "signoz"
const SIGNOZ_K8S_INFRA_RELEASE_NAME = "signoz-k8s-infra"
const SIGNOZ_DATABASE_SECRET_NAME = "signoz"
const SIGNOZ_SERVICE_NAME = "signoz"
const SIGNOZ_SERVICE_PORT = 8080
const SIGNOZ_OTEL_COLLECTOR_SERVICE_NAME = `${SIGNOZ_SERVICE_NAME}-otel-collector`
const SIGNOZ_OTLP_GRPC_PORT = 4317
const SIGNOZ_POSTGRES_DATABASE_NAME = "signoz"
const SIGNOZ_POSTGRES_USERNAME = "signoz"
const SIGNOZ_SECRET_POSTGRES_PASSWORD_KEY = "postgres-password"
const SIGNOZ_SECRET_POSTGRES_DSN_KEY = "postgres-dsn"
const SIGNOZ_SECRET_TOKENIZER_JWT_SECRET_KEY = "tokenizer-jwt-secret"

type SignozCredentials = {
  postgresPassword: string
  postgresDsn: string
  tokenizerJwtSecret: string
}

/**
 * Ensures SigNoz is installed in the infra replica namespace.
 *
 * The chart-managed ClickHouse is used, while SQL store stays on external Postgres.
 */
export async function ensureMonitoringBootstrap(
  adminPool: Pool,
  prisma: PrismaClient,
): Promise<void> {
  const namespace = getReplicaNamespace()
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)
  const customObjectsApi = kubeConfig.makeApiClient(CustomObjectsApi)

  await ensureHelmRepositories()

  const adminConfig = await loadPostgresAdminConfig()
  const signozCredentials = await ensureSignozSecret(coreApi, adminConfig)

  await ensureDatabaseRole(adminPool, SIGNOZ_POSTGRES_USERNAME, signozCredentials.postgresPassword)
  await ensureAdminReplicaDatabase(
    adminPool,
    SIGNOZ_POSTGRES_DATABASE_NAME,
    SIGNOZ_POSTGRES_USERNAME,
  )

  const signozValuesFilePath = await createSignozValuesFile(signozCredentials)
  const signozK8sInfraValuesFilePath = await createSignozK8sInfraValuesFile(namespace)

  try {
    await runSignozHelmUpgrade(namespace, signozValuesFilePath)
    await runSignozK8sInfraHelmUpgrade(namespace, signozK8sInfraValuesFilePath)
  } finally {
    await rm(signozValuesFilePath, { force: true })
    await rm(dirname(signozValuesFilePath), { recursive: true, force: true })
    await rm(signozK8sInfraValuesFilePath, { force: true })
    await rm(dirname(signozK8sInfraValuesFilePath), { recursive: true, force: true })
  }

  const infraGatewayConfig = await loadInfraGatewayConfig(coreApi, namespace)
  const gateway = await ensureGatewayRegistration(prisma, {
    name: MONITORING_GATEWAY_NAME,
    ownerReplicaName: getReplicaName(),
    title: "Мониторинг",
    description: "Шлюз для панели мониторинга",
  })

  await upsertGatewayResources(customObjectsApi, infraGatewayConfig, gateway)
  await bootstrapGatewayRoute({
    gatewayName: MONITORING_GATEWAY_NAME,
    endpoint: `${MONITORING_GATEWAY_NAME}.${infraGatewayConfig.clusterDomain}`,
    routeName: MONITORING_GATEWAY_NAME,
    paths: ["/"],
    backendServiceName: SIGNOZ_SERVICE_NAME,
    backendServicePort: SIGNOZ_SERVICE_PORT,
  })
}

async function ensureHelmRepositories(): Promise<void> {
  const signozRepoResult = await runHelmCommand([
    "helm",
    "repo",
    "add",
    "signoz",
    "https://charts.signoz.io",
    "--force-update",
  ])
  if (signozRepoResult.exitCode !== 0) {
    throw new Error(`Helm repo add failed for "signoz" with exit code ${signozRepoResult.exitCode}`)
  }

  const updateResult = await runHelmCommand(["helm", "repo", "update"])
  if (updateResult.exitCode !== 0) {
    throw new Error(`Helm repo update failed with exit code ${updateResult.exitCode}`)
  }
}

async function ensureSignozSecret(
  coreApi: CoreV1Api,
  adminConfig: Awaited<ReturnType<typeof loadPostgresAdminConfig>>,
): Promise<SignozCredentials> {
  const namespace = adminConfig.namespace
  const generatedPostgresPassword = randomBytes(24).toString("base64url")
  const generatedPostgresDsn = buildDatabaseConnectionString(
    {
      ...adminConfig,
      username: SIGNOZ_POSTGRES_USERNAME,
      password: generatedPostgresPassword,
    },
    SIGNOZ_POSTGRES_DATABASE_NAME,
  )
  const generatedTokenizerJwtSecret = randomBytes(32).toString("base64url")

  try {
    const secret = await coreApi.readNamespacedSecret({
      name: SIGNOZ_DATABASE_SECRET_NAME,
      namespace,
    })

    const postgresPassword = decodeSecretValue(
      secret.data?.[SIGNOZ_SECRET_POSTGRES_PASSWORD_KEY],
      `Secret "${SIGNOZ_DATABASE_SECRET_NAME}" is missing "${SIGNOZ_SECRET_POSTGRES_PASSWORD_KEY}"`,
    )
    const postgresDsn = secret.data?.[SIGNOZ_SECRET_POSTGRES_DSN_KEY]
      ? decodeSecretValue(
          secret.data[SIGNOZ_SECRET_POSTGRES_DSN_KEY],
          `Secret "${SIGNOZ_DATABASE_SECRET_NAME}" is missing "${SIGNOZ_SECRET_POSTGRES_DSN_KEY}"`,
        )
      : buildDatabaseConnectionString(
          {
            ...adminConfig,
            username: SIGNOZ_POSTGRES_USERNAME,
            password: postgresPassword,
          },
          SIGNOZ_POSTGRES_DATABASE_NAME,
        )
    const tokenizerJwtSecret = secret.data?.[SIGNOZ_SECRET_TOKENIZER_JWT_SECRET_KEY]
      ? decodeSecretValue(
          secret.data[SIGNOZ_SECRET_TOKENIZER_JWT_SECRET_KEY],
          `Secret "${SIGNOZ_DATABASE_SECRET_NAME}" is missing "${SIGNOZ_SECRET_TOKENIZER_JWT_SECRET_KEY}"`,
        )
      : generatedTokenizerJwtSecret

    const shouldReplaceSecret =
      !secret.data?.[SIGNOZ_SECRET_POSTGRES_DSN_KEY] ||
      !secret.data?.[SIGNOZ_SECRET_TOKENIZER_JWT_SECRET_KEY]

    if (shouldReplaceSecret) {
      await coreApi.replaceNamespacedSecret({
        name: SIGNOZ_DATABASE_SECRET_NAME,
        namespace,
        body: {
          apiVersion: "v1",
          kind: "Secret",
          metadata: {
            name: SIGNOZ_DATABASE_SECRET_NAME,
            namespace,
            resourceVersion: secret.metadata?.resourceVersion,
          },
          type: "Opaque",
          data: {
            ...(secret.data ?? {}),
            [SIGNOZ_SECRET_POSTGRES_PASSWORD_KEY]: encodeSecretValue(postgresPassword),
            [SIGNOZ_SECRET_POSTGRES_DSN_KEY]: encodeSecretValue(postgresDsn),
            [SIGNOZ_SECRET_TOKENIZER_JWT_SECRET_KEY]: encodeSecretValue(tokenizerJwtSecret),
          },
        },
      })
    }

    return {
      postgresPassword,
      postgresDsn,
      tokenizerJwtSecret,
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
        name: SIGNOZ_DATABASE_SECRET_NAME,
        namespace,
      },
      type: "Opaque",
      data: {
        [SIGNOZ_SECRET_POSTGRES_PASSWORD_KEY]: encodeSecretValue(generatedPostgresPassword),
        [SIGNOZ_SECRET_POSTGRES_DSN_KEY]: encodeSecretValue(generatedPostgresDsn),
        [SIGNOZ_SECRET_TOKENIZER_JWT_SECRET_KEY]: encodeSecretValue(generatedTokenizerJwtSecret),
      },
    },
  })

  return {
    postgresPassword: generatedPostgresPassword,
    postgresDsn: generatedPostgresDsn,
    tokenizerJwtSecret: generatedTokenizerJwtSecret,
  }
}

async function createSignozValuesFile(_signozCredentials: SignozCredentials): Promise<string> {
  const directoryPath = await mkdtemp(join(tmpdir(), "reside-monitoring-signoz-"))
  const filePath = join(directoryPath, "values.yaml")

  const values = {
    fullnameOverride: SIGNOZ_SERVICE_NAME,
    postgresql: {
      enabled: false,
    },
    clickhouse: {
      clickhouseOperator: {
        zookeeperLog: {
          ttl: 7,
          flushInterval: 7500,
        },
        queryLog: {
          ttl: 7,
          flushInterval: 7500,
        },
        partLog: {
          ttl: 7,
          flushInterval: 7500,
        },
        traceLog: {
          ttl: 7,
          flushInterval: 7500,
        },
        metricLog: {
          ttl: 15,
          flushInterval: 7500,
        },
        sessionLog: {
          ttl: 15,
          flushInterval: 7500,
        },
      },
    },
    signoz: {
      env: {
        signoz_sqlstore_provider: "postgres",
        signoz_sqlstore_postgres_dsn: {
          valueFrom: {
            secretKeyRef: {
              name: SIGNOZ_DATABASE_SECRET_NAME,
              key: SIGNOZ_SECRET_POSTGRES_DSN_KEY,
            },
          },
        },
        signoz_tokenizer_jwt_secret: {
          valueFrom: {
            secretKeyRef: {
              name: SIGNOZ_DATABASE_SECRET_NAME,
              key: SIGNOZ_SECRET_TOKENIZER_JWT_SECRET_KEY,
            },
          },
        },
      },
    },
  }

  await writeFile(filePath, `${JSON.stringify(values, null, 2)}\n`)

  return filePath
}

async function createSignozK8sInfraValuesFile(namespace: string): Promise<string> {
  const directoryPath = await mkdtemp(join(tmpdir(), "reside-monitoring-signoz-k8s-infra-"))
  const filePath = join(directoryPath, "values.yaml")

  const values = {
    otelCollectorEndpoint: `${SIGNOZ_OTEL_COLLECTOR_SERVICE_NAME}.${namespace}.svc.cluster.local:${SIGNOZ_OTLP_GRPC_PORT}`,
    otelInsecure: true,
    insecureSkipVerify: false,
    presets: {
      kubernetesAttributes: {
        extractLabels: [
          {
            from: "pod",
            key: "reside.io/replica",
            tag_name: "reside.replica",
          },
          {
            from: "pod",
            key: "reside.io/component",
            tag_name: "reside.component",
          },
          {
            from: "pod",
            key: "app.kubernetes.io/name",
            tag_name: "service.name",
          },
        ],
      },
    },
  }

  await writeFile(filePath, `${JSON.stringify(values, null, 2)}\n`)

  return filePath
}

async function runSignozHelmUpgrade(namespace: string, valuesFilePath: string): Promise<void> {
  await recoverPendingHelmRelease(namespace, SIGNOZ_RELEASE_NAME)

  const command = [
    "helm",
    "upgrade",
    "--install",
    SIGNOZ_RELEASE_NAME,
    "signoz/signoz",
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

async function runSignozK8sInfraHelmUpgrade(
  namespace: string,
  valuesFilePath: string,
): Promise<void> {
  await recoverPendingHelmRelease(namespace, SIGNOZ_K8S_INFRA_RELEASE_NAME)

  const command = [
    "helm",
    "upgrade",
    "--install",
    SIGNOZ_K8S_INFRA_RELEASE_NAME,
    "signoz/k8s-infra",
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
