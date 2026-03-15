import { CustomObjectsApi } from "@kubernetes/client-node"
import { getReplicaImage, getReplicaName, getReplicaNamespace, kubeConfig } from "../kubernetes"
import { logger } from "../logger"
import { ensureKnativeService } from "./resources"
import { buildReplicaContainerEnv } from "./shared"

export type ServiceOptions = {
  /**
   * Whether to keep this service always running and not allow it to scale to zero.
   */
  longRunning?: boolean
}

/**
 * Bootstraps the Knative Service for the current replica.
 */
export async function bootstrapService(options: ServiceOptions = {}): Promise<void> {
  const customObjectsApi = kubeConfig.makeApiClient(CustomObjectsApi)

  await ensureKnativeService(customObjectsApi, {
    apiVersion: "serving.knative.dev/v1",
    kind: "Service",
    metadata: {
      name: getReplicaName(),
      namespace: getReplicaNamespace(),
    },
    spec: {
      template: {
        metadata: {
          annotations: options.longRunning
            ? { "autoscaling.knative.dev/min-scale": "1" }
            : undefined,
        },
        spec: {
          serviceAccountName: getReplicaName(),
          terminationGracePeriodSeconds: 30,
          containers: [
            {
              name: getReplicaNamespace(),
              image: getReplicaImage(),
              env: buildReplicaContainerEnv(getReplicaName(), [
                { name: "RESIDE_BIN", value: "replica" },
              ]),
              ports: [{ name: "h2c", containerPort: 8080 }],
            },
          ],
        },
      },
    },
  })

  logger.info('created/updated knative using image "%s"', getReplicaImage())
}
