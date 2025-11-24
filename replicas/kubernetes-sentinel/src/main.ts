import type { KubernetesManagedObjectCollection } from "@contracts/kubernetes-sentinel.v1"
import { loadConfig, singleConcurrencyFireAndForget } from "@reside/shared"
import { startReplica } from "@reside/shared/node"
import { ClusterAlpha } from "./cluster"
import { Config } from "./config"
import { type ObjectType, objectTypes } from "./object-type"
import { KubernetesSentinel } from "./replica"

const {
  implementations: { k8s },
  logger,
} = await startReplica(KubernetesSentinel)

const config = loadConfig(Config)

const loadedK8s = await k8s.data.$jazz.ensureLoaded({
  resolve: {
    deployments: { $each: true },
    statefulSets: { $each: true },
    jobs: { $each: true },
    secrets: { $each: true },
    configMaps: { $each: true },
    services: { $each: true },
    ingresses: { $each: true },
    networkPolicies: { $each: true },
    roles: { $each: true },
    roleBindings: { $each: true },
    persistentVolumeClaims: { $each: true },
    serviceAccounts: { $each: true },
  },
})

const clusterAlpha = new ClusterAlpha(config.RESIDE_NAMESPACE, logger)

function setupCollection<T>(
  collection: KubernetesManagedObjectCollection<T>,
  objectType: ObjectType,
): void {
  const syncHandler = singleConcurrencyFireAndForget(
    async (current: KubernetesManagedObjectCollection<T>, objectType: ObjectType) => {
      try {
        await clusterAlpha.syncManagedObjects(current, objectType)
      } catch (err) {
        logger.error({ err }, `failed to sync managed objects for %s`, objectType.kind)
      }
    },
  )

  // 1. setup subscription to watch for changes and apply them to the cluster (will also trigger on startup)
  collection.$jazz.subscribe(items => syncHandler(items, objectType))

  // 2. setup watcher to monitor cluster changes and update managed objects accordingly
  clusterAlpha.setupWatcher(collection, objectType)

  logger.info(`set up management for %s`, objectType.kind)
}

setupCollection(loadedK8s.deployments, objectTypes.deployment)
setupCollection(loadedK8s.statefulSets, objectTypes.statefulSet)
setupCollection(loadedK8s.jobs, objectTypes.job)
setupCollection(loadedK8s.secrets, objectTypes.secret)
setupCollection(loadedK8s.configMaps, objectTypes.configMap)
setupCollection(loadedK8s.services, objectTypes.service)
setupCollection(loadedK8s.ingresses, objectTypes.ingress)
setupCollection(loadedK8s.networkPolicies, objectTypes.networkPolicy)
setupCollection(loadedK8s.roles, objectTypes.role)
setupCollection(loadedK8s.roleBindings, objectTypes.roleBinding)
setupCollection(loadedK8s.persistentVolumeClaims, objectTypes.persistentVolumeClaim)
setupCollection(loadedK8s.serviceAccounts, objectTypes.serviceAccount)

logger.info("Kubernetes Sentinel started")
