import type { BatchV1Api } from "@kubernetes/client-node"
import { randomUUID } from "node:crypto"

export type EnsureMinioBucketAccessInput = {
  batchApi: BatchV1Api
  namespace: string
  endpoint: string
  adminUser: string
  adminPassword: string
  bucket: string
  accessKey: string
  secretKey: string
}

export async function ensureMinioBucketAccess({
  batchApi,
  namespace,
  endpoint,
  adminUser,
  adminPassword,
  bucket,
  accessKey,
  secretKey,
}: EnsureMinioBucketAccessInput): Promise<void> {
  const normalizedBucket = normalizeBucketName(bucket)
  const policyName = `bucket-${normalizedBucket}`

  await runMinioAdminJob({
    batchApi,
    namespace,
    endpoint,
    adminUser,
    adminPassword,
    script: [
      "set -e",
      'mc alias set local "$MINIO_ENDPOINT" "$MINIO_ADMIN_USER" "$MINIO_ADMIN_PASSWORD"',
      `mc mb --ignore-existing "local/${normalizedBucket}"`,
      `if ! mc admin user info local "${accessKey}" >/dev/null 2>&1; then`,
      `  mc admin user add local "${accessKey}" "${secretKey}"`,
      "fi",
      "cat >/tmp/policy.json <<'EOF'",
      JSON.stringify(
        {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: ["s3:ListBucket", "s3:GetBucketLocation"],
              Resource: [`arn:aws:s3:::${normalizedBucket}`],
            },
            {
              Effect: "Allow",
              Action: [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:AbortMultipartUpload",
                "s3:ListBucketMultipartUploads",
                "s3:ListMultipartUploadParts",
              ],
              Resource: [`arn:aws:s3:::${normalizedBucket}/*`],
            },
          ],
        },
        null,
        2,
      ),
      "EOF",
      `mc admin policy create local "${policyName}" /tmp/policy.json >/dev/null 2>&1 || true`,
      `mc admin policy attach local "${policyName}" --user "${accessKey}"`,
    ].join("\n"),
  })
}

export type EnsureMinioConsoleUserInput = {
  batchApi: BatchV1Api
  namespace: string
  endpoint: string
  adminUser: string
  adminPassword: string
  consoleUser: string
  consolePassword: string
}

export async function ensureMinioConsoleUser({
  batchApi,
  namespace,
  endpoint,
  adminUser,
  adminPassword,
  consoleUser,
  consolePassword,
}: EnsureMinioConsoleUserInput): Promise<void> {
  await runMinioAdminJob({
    batchApi,
    namespace,
    endpoint,
    adminUser,
    adminPassword,
    script: [
      "set -e",
      'mc alias set local "$MINIO_ENDPOINT" "$MINIO_ADMIN_USER" "$MINIO_ADMIN_PASSWORD"',
      `if ! mc admin user info local "${consoleUser}" >/dev/null 2>&1; then`,
      `  mc admin user add local "${consoleUser}" "${consolePassword}"`,
      "fi",
      "cat >/tmp/console-admin.json <<'EOF'",
      JSON.stringify(
        {
          Version: "2012-10-17",
          Statement: [
            {
              Action: ["admin:*"],
              Effect: "Allow",
            },
            {
              Action: ["s3:*"],
              Effect: "Allow",
              Resource: ["arn:aws:s3:::*"],
            },
          ],
        },
        null,
        2,
      ),
      "EOF",
      "mc admin policy create local console-admin /tmp/console-admin.json >/dev/null 2>&1 || true",
      `mc admin policy attach local console-admin --user "${consoleUser}"`,
    ].join("\n"),
  })
}

type RunMinioAdminJobInput = {
  batchApi: BatchV1Api
  namespace: string
  endpoint: string
  adminUser: string
  adminPassword: string
  script: string
}

async function runMinioAdminJob({
  batchApi,
  namespace,
  endpoint,
  adminUser,
  adminPassword,
  script,
}: RunMinioAdminJobInput): Promise<void> {
  const baseName = `minio-admin-${randomUUID().slice(0, 8)}`
  const jobName = baseName
  const labels = {
    "reside.io/managed-by": "infra",
    "reside.io/component": "minio-admin",
  }

  await batchApi.createNamespacedJob({
    namespace,
    body: {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: {
        name: jobName,
        namespace,
        labels,
      },
      spec: {
        ttlSecondsAfterFinished: 300,
        backoffLimit: 0,
        template: {
          metadata: {
            labels,
          },
          spec: {
            restartPolicy: "Never",
            containers: [
              {
                name: "mc",
                image: "minio/mc:latest",
                command: ["sh", "-ec", script],
                env: [
                  {
                    name: "MINIO_ENDPOINT",
                    value: endpoint,
                  },
                  {
                    name: "MINIO_ADMIN_USER",
                    value: adminUser,
                  },
                  {
                    name: "MINIO_ADMIN_PASSWORD",
                    value: adminPassword,
                  },
                ],
              },
            ],
          },
        },
      },
    },
  })

  await waitForJobCompletion(batchApi, namespace, jobName)
}

async function waitForJobCompletion(
  batchApi: BatchV1Api,
  namespace: string,
  jobName: string,
): Promise<void> {
  const attempts = 120

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const job = await batchApi.readNamespacedJobStatus({
      namespace,
      name: jobName,
    })

    const succeeded = job.status?.succeeded ?? 0
    if (succeeded > 0) {
      return
    }

    const failed = job.status?.failed ?? 0
    if (failed > 0) {
      throw new Error(`MinIO admin job "${jobName}" failed`)
    }

    await Bun.sleep(1_000)
  }

  throw new Error(`MinIO admin job "${jobName}" did not complete in time`)
}

export function normalizeBucketName(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/\.+/g, ".")
    .replace(/^[.-]+|[.-]+$/g, "")

  if (normalized.length < 3) {
    return `${normalized}-bucket`
  }

  return normalized.slice(0, 63)
}
