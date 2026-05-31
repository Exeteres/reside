import { CustomObjectsApi } from "@kubernetes/client-node"
import { getReplicaImage, getReplicaName, getReplicaNamespace, kubeConfig } from "../kubernetes"
import { logger } from "../logger"
import { ensureKnativeService } from "./resources"
import { buildReplicaContainerEnv } from "./shared"
import type { ReplicaEnvironmentVariable } from "./types"

export type ServiceOptions = {
  /**
   * Whether to keep this service always running and not allow it to scale to zero.
   */
  longRunning?: boolean

  /**
   * Additional environment variables injected into replica container.
   */
  extraEnv?: ReplicaEnvironmentVariable[]
}

/**
 * Bootstraps the Knative Service for the current replica.
 */
export async function bootstrapService(options: ServiceOptions = {}): Promise<void> {
  const customObjectsApi = kubeConfig.makeApiClient(CustomObjectsApi)
  const replicaName = getReplicaName()

  await ensureKnativeService(customObjectsApi, {
    apiVersion: "serving.knative.dev/v1",
    kind: "Service",
    metadata: {
      name: replicaName,
      namespace: getReplicaNamespace(),
      labels: {
        "app.kubernetes.io/name": `replica-${replicaName}`,
      },
    },
    spec: {
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/name": `replica-${replicaName}`,
            "reside.io/replica": replicaName,
            "reside.io/component": "replica",
          },
          annotations: options.longRunning
            ? { "autoscaling.knative.dev/min-scale": "1" }
            : undefined,
        },
        spec: {
          serviceAccountName: replicaName,
          terminationGracePeriodSeconds: 30,
          containers: [
            {
              name: getReplicaNamespace(),
              image: getReplicaImage(),
              env: buildReplicaContainerEnv("replica", [
                { name: "RESIDE_BIN", value: "replica" },
                ...(options.extraEnv ?? []),
              ]),
              ports: [{ containerPort: 8080 }],
            },
          ],
        },
      },
    },
  })

  logger.info('created/updated knative using image "%s"', getReplicaImage())
}
