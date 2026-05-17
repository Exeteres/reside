import { randomBytes } from "node:crypto"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { AppsV1Api, CoreV1Api } from "@kubernetes/client-node"
import { getReplicaNamespace, kubeConfig } from "@reside/common"
import { getStatusCode } from "@reside/utils"
import {
  POSTGRES_ADMIN_PASSWORD_KEY,
  POSTGRES_ADMIN_SECRET_NAME,
  POSTGRES_RELEASE_NAME,
  POSTGRES_SERVICE_NAME,
} from "../shared"
import { recoverPendingHelmRelease, runHelmCommand } from "./helm"

/**
 * Ensures the shared PostgreSQL release is installed in the current namespace.
 *
 * @returns Nothing.
 */
export async function ensurePostgresBootstrap(): Promise<void> {
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)
  const appsApi = kubeConfig.makeApiClient(AppsV1Api)
  const namespace = getReplicaNamespace()

  await ensureAdminSecret(coreApi, namespace)
  const valuesFilePath = await createHelmValuesFile()

  try {
    await runHelmUpgrade(namespace, valuesFilePath)
    await waitForStatefulSetReady(appsApi, namespace, POSTGRES_SERVICE_NAME)
  } finally {
    await rm(valuesFilePath, { force: true })
    await rm(dirname(valuesFilePath), { recursive: true, force: true })
  }
}

async function ensureAdminSecret(coreApi: CoreV1Api, namespace: string): Promise<void> {
  try {
    await coreApi.readNamespacedSecret({
      name: POSTGRES_ADMIN_SECRET_NAME,
      namespace,
    })

    return
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  const password = generatePassword()
  await coreApi.createNamespacedSecret({
    namespace,
    body: {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: POSTGRES_ADMIN_SECRET_NAME,
        namespace,
      },
      type: "Opaque",
      data: {
        [POSTGRES_ADMIN_PASSWORD_KEY]: encodeSecretValue(password),
      },
    },
  })
}

async function createHelmValuesFile(): Promise<string> {
  const directoryPath = await mkdtemp(join(tmpdir(), "reside-database-"))
  const filePath = join(directoryPath, "values.yaml")

  const values = {
    fullnameOverride: POSTGRES_SERVICE_NAME,
    auth: {
      existingSecret: POSTGRES_ADMIN_SECRET_NAME,
      secretKeys: {
        adminPasswordKey: POSTGRES_ADMIN_PASSWORD_KEY,
      },
    },
    metrics: {
      enabled: false,
    },
    service: {
      type: "ClusterIP",
    },
    persistence: {
      enabled: true,
      size: "8Gi",
    },
  }

  await writeFile(filePath, `${JSON.stringify(values, null, 2)}\n`)

  return filePath
}

async function runHelmUpgrade(namespace: string, valuesFilePath: string): Promise<void> {
  await recoverPendingHelmRelease(namespace, POSTGRES_RELEASE_NAME)
  const chartPath = await resolveLocalChartArchive("postgres")

  const command = [
    "helm",
    "upgrade",
    "--install",
    POSTGRES_RELEASE_NAME,
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

async function waitForStatefulSetReady(
  appsApi: AppsV1Api,
  namespace: string,
  name: string,
): Promise<void> {
  const attempts = 120

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const statefulSet = await appsApi.readNamespacedStatefulSetStatus({
      name,
      namespace,
    })

    const readyReplicas = statefulSet.status?.readyReplicas ?? 0
    if (readyReplicas >= 1) {
      return
    }

    await Bun.sleep(5_000)
  }

  throw new Error(`StatefulSet "${name}" in namespace "${namespace}" did not become ready`)
}

function generatePassword(): string {
  return randomBytes(24).toString("base64url")
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
