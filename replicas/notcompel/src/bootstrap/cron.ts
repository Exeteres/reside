import { BatchV1Api } from "@kubernetes/client-node"
import {
  getReplicaImage,
  getReplicaName,
  getReplicaNamespace,
  getReplicaServiceAccountName,
  kubeConfig,
  logger,
} from "@reside/common"

const CRON_JOB_NAME = "notcompel-daily-image"

export async function bootstrapNotcompelCronJob(): Promise<void> {
  const batchApi = kubeConfig.makeApiClient(BatchV1Api)
  const namespace = getReplicaNamespace()
  const replicaName = getReplicaName()

  await batchApi.patchNamespacedCronJob({
    name: CRON_JOB_NAME,
    namespace,
    body: buildCronJob(namespace, replicaName),
    fieldManager: "notcompel-bootstrap",
    force: true,
  })

  logger.info('created/updated cronjob "%s" in namespace "%s"', CRON_JOB_NAME, namespace)
}

function buildCronContainerEnv(
  replicaName: string,
  namespace: string,
): Array<{ name: string; value: string }> {
  return [
    { name: "RESIDE_REPLICA", value: replicaName },
    { name: "RESIDE_NAMESPACE", value: namespace },
    { name: "RESIDE_BIN", value: "replica" },
    { name: "NOTCOMPEL_RUN_ON_START", value: "true" },
  ]
}

function buildCronJob(namespace: string, replicaName: string): Record<string, unknown> {
  return {
    apiVersion: "batch/v1",
    kind: "CronJob",
    metadata: {
      name: CRON_JOB_NAME,
      namespace,
      labels: {
        "app.kubernetes.io/name": `replica-${replicaName}`,
        "reside.io/replica": replicaName,
        "reside.io/component": "daily-image-cron",
      },
    },
    spec: {
      schedule: "0 12 * * *",
      timeZone: "Europe/Moscow",
      concurrencyPolicy: "Forbid",
      successfulJobsHistoryLimit: 1,
      failedJobsHistoryLimit: 3,
      jobTemplate: {
        spec: {
          backoffLimit: 1,
          template: {
            metadata: {
              labels: {
                "app.kubernetes.io/name": `replica-${replicaName}`,
                "reside.io/replica": replicaName,
                "reside.io/component": "daily-image-cron",
              },
            },
            spec: {
              restartPolicy: "Never",
              serviceAccountName: getReplicaServiceAccountName(),
              containers: [
                {
                  name: "send-image",
                  image: getReplicaImage(),
                  imagePullPolicy: "Always",
                  env: buildCronContainerEnv(replicaName, namespace),
                },
              ],
            },
          },
        },
      },
    },
  }
}
