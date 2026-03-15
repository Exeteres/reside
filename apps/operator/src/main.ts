import {
  BatchV1Api,
  CoreV1Api,
  CustomObjectsApi,
  KubeConfig,
  RbacAuthorizationV1Api,
} from "@kubernetes/client-node"
import { operatorConfig } from "./config"
import { logger } from "./logger"
import {
  cleanupOrphanReplicaNamespaces,
  listReplicas,
  patchReplicaStatus,
  reconcileReplica,
} from "./reconciler"

const kubeConfig = new KubeConfig()
kubeConfig.loadFromDefault()

const customObjectsApi = kubeConfig.makeApiClient(CustomObjectsApi)
const coreApi = kubeConfig.makeApiClient(CoreV1Api)
const rbacApi = kubeConfig.makeApiClient(RbacAuthorizationV1Api)
const batchApi = kubeConfig.makeApiClient(BatchV1Api)

logger.info(
  { namespace: operatorConfig.controlNamespace },
  'starting reside operator for namespace "%s"',
  operatorConfig.controlNamespace,
)

while (true) {
  try {
    const replicas = await listReplicas(customObjectsApi)

    try {
      await cleanupOrphanReplicaNamespaces(coreApi, replicas)
    } catch (error) {
      logger.error({ error }, "failed to cleanup orphan replica namespaces")
    }

    for (const replica of replicas) {
      try {
        const reconcileStatus = await reconcileReplica(coreApi, rbacApi, batchApi, replica)
        await patchReplicaStatus(customObjectsApi, replica, reconcileStatus)
      } catch (error) {
        logger.error({ error, replicaName: replica.name }, "failed to reconcile replica")

        try {
          await patchReplicaStatus(customObjectsApi, replica, {
            phase: "Reconciling",
            conditionStatus: "False",
            reason: "ReconcileFailed",
            message: error instanceof Error ? error.message : "unknown reconcile error",
          })
        } catch (statusError) {
          logger.error(
            { error: statusError, replicaName: replica.name },
            "failed to patch replica status",
          )
        }
      }
    }
  } catch (error) {
    logger.error({ error }, "failed to list replicas")
  }

  await Bun.sleep(operatorConfig.reconcileIntervalMs)
}
