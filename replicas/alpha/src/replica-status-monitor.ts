import type {
  KubernetesSentinelData,
  OptionalKubernetesManagedObjectCollection,
} from "@contracts/kubernetes-sentinel.v1"
import type { IDeployment } from "kubernetes-models/apps/v1"
import type { IJob } from "kubernetes-models/batch/v1"
import type { Logger } from "pino"
import { type AlphaData, Replica, type ReplicaVersion } from "@contracts/alpha.v1"
import { singleConcurrencyFireAndForget } from "@reside/shared"
import { co } from "jazz-tools"

const LoadedReplicaCollection = co.list(Replica)

type LoadedReplicaCollection = co.loaded<
  typeof LoadedReplicaCollection,
  { $each: { currentVersion: true; versions: { $each: true } } }
>

type LoadedReplica = LoadedReplicaCollection[number]

type ReplicaVersionStatus = ReplicaVersion["status"]

type DeploymentCollection = OptionalKubernetesManagedObjectCollection<IDeployment>
type JobCollection = OptionalKubernetesManagedObjectCollection<IJob>

type DeploymentCondition = NonNullable<NonNullable<IDeployment["status"]>["conditions"]>[number]

type JobCondition = NonNullable<NonNullable<IJob["status"]>["conditions"]>[number]

export function reconcileReplicaStatuses(
  replicas: LoadedReplicaCollection,
  deployments: DeploymentCollection,
  jobs: JobCollection,
  logger: Logger,
): void {
  for (const replica of replicas) {
    if (!replica.currentVersion || !replica.versions.values) {
      // not fully created yet
      continue
    }

    for (const version of replica.versions.values()) {
      if (!version.$isLoaded) {
        logger.warn(
          `failed to load version "%d" of replica "%s" while reconciling status: %s`,
          version.id,
          replica.name,
          version.$jazz.loadingState,
        )
        continue
      }

      const status = determineReplicaVersionStatus(replica, version, deployments, jobs, logger)
      if (!status) {
        continue
      }

      const previousStatus = version.status
      if (previousStatus === status) {
        continue
      }

      logger.debug(
        `replica "%s" version "%d" status changed from %s to %s`,
        replica.name,
        version.id,
        previousStatus,
        status,
      )

      version.$jazz.set("status", status)
    }
  }
}

const reconcileReplicaStatusesHandler = singleConcurrencyFireAndForget(reconcileReplicaStatuses)

function determineReplicaVersionStatus(
  replica: LoadedReplica,
  version: ReplicaVersion,
  deployments: DeploymentCollection,
  jobs: JobCollection,
  logger: Logger,
): ReplicaVersionStatus | null {
  if (!replica.currentVersion) {
    return null
  }

  if (replica.info.class === "long-running") {
    return determineDeploymentStatus(
      replica,
      version,
      deployments[`${replica.name}-${version.id}`],
      logger,
    )
  }

  return determineJobStatus(replica, version, jobs[`${replica.name}-${version.id}`], logger)
}

function determineDeploymentStatus(
  replica: LoadedReplica,
  version: ReplicaVersion,
  deployment: DeploymentCollection[string] | undefined,
  logger: Logger,
): ReplicaVersionStatus | null {
  if (!deployment) {
    logger.warn(
      `no deployment found for replica "%s" version "%d" while reconciling status`,
      replica.name,
      version.id,
    )
    return "unknown"
  }

  if (!deployment.$isLoaded) {
    logger.warn(
      `failed to load deployment for replica "%s" version "%d" while reconciling status: %s`,
      replica.name,
      version.id,
      deployment.$jazz.loadingState,
    )
    return null
  }

  if (!replica.currentVersion) {
    // not fully created yet
    return "unknown"
  }

  if (deployment.status === "error") {
    return "error"
  }

  const isCurrent = replica.currentVersion.id === version.id
  const desiredReplicas = deployment.manifest?.spec?.replicas ?? 0
  const liveStatus = deployment.live?.status
  const liveConditions = (liveStatus?.conditions ?? []) as DeploymentCondition[]
  const replicas = liveStatus?.replicas ?? 0
  const readyReplicas = liveStatus?.readyReplicas ?? 0
  const hasReplicaFailure = liveConditions.some(
    condition => condition.type === "ReplicaFailure" && condition.status === "True",
  )
  const isAvailable = liveConditions.some(
    condition => condition.type === "Available" && condition.status === "True",
  )
  const isProgressing = liveConditions.some(
    condition => condition.type === "Progressing" && condition.status === "True",
  )

  if (hasReplicaFailure) {
    return "error"
  }

  if (!isCurrent) {
    if (desiredReplicas === 0) {
      return replicas > 0 ? "stopping" : "stopped"
    }

    if (isAvailable || readyReplicas > 0 || isProgressing) {
      return "running-outdated"
    }

    return "unknown"
  }

  if (desiredReplicas === 0) {
    return replicas > 0 ? "stopping" : "stopped"
  }

  if (!liveStatus) {
    return "starting"
  }

  if (isAvailable && readyReplicas >= desiredReplicas) {
    return "running"
  }

  if (readyReplicas > 0) {
    return "degraded"
  }

  if (isProgressing || desiredReplicas > 0) {
    return "starting"
  }

  return "unknown"
}

function determineJobStatus(
  replica: LoadedReplica,
  version: ReplicaVersion,
  job: JobCollection[string] | undefined,
  logger: Logger,
): ReplicaVersionStatus | null {
  if (!job) {
    logger.warn(
      `no job found for replica "%s" version "%d" while reconciling status`,
      replica.name,
      version.id,
    )
    return "unknown"
  }

  if (!job.$isLoaded) {
    logger.warn(
      `failed to load job for replica "%s" version "%d" while reconciling status: %s`,
      replica.name,
      version.id,
      job.$jazz.loadingState,
    )
    return null
  }

  if (job.status === "error") {
    return "error"
  }

  const liveStatus = job.live?.status
  const conditions = (liveStatus?.conditions ?? []) as JobCondition[]

  const hasFailed =
    conditions.some(condition => condition.type === "Failed" && condition.status === "True") ||
    (liveStatus?.failed ?? 0) > 0
  if (hasFailed) {
    return "error"
  }

  const hasCompleted =
    conditions.some(condition => condition.type === "Complete" && condition.status === "True") ||
    (liveStatus?.succeeded ?? 0) > 0
  if (hasCompleted) {
    return "completed"
  }

  if ((liveStatus?.active ?? 0) > 0) {
    return "running"
  }

  if (job.manifest === null) {
    return "completed"
  }

  return "starting"
}

/**
 * Setup the reconciliation loop for replica statuses.
 * It monitors Kubernetes workloads and updates replica version statuses accordingly.
 */
export async function setupReplicaStatusReconcilation(
  alphaData: AlphaData,
  k8sData: KubernetesSentinelData,
  logger: Logger,
): Promise<void> {
  const loadedAlpha = await alphaData.$jazz.ensureLoaded({
    resolve: {
      replicas: {
        $each: {
          currentVersion: true,
          versions: { $each: true },
        },
      },
    },
  })

  const loadedK8s = await k8sData.$jazz.ensureLoaded({
    resolve: {
      deployments: {
        $each: { $onError: "catch" },
      },
      jobs: {
        $each: { $onError: "catch" },
      },
    },
  })

  let replicas = loadedAlpha.replicas
  let deployments = loadedK8s.deployments
  let jobs = loadedK8s.jobs

  loadedK8s.deployments.$jazz.subscribe(newDeployments => {
    deployments = newDeployments
    reconcileReplicaStatusesHandler(replicas, deployments, jobs, logger)
  })

  loadedK8s.jobs.$jazz.subscribe(newJobs => {
    jobs = newJobs
    reconcileReplicaStatusesHandler(replicas, deployments, jobs, logger)
  })

  loadedAlpha.replicas.$jazz.subscribe(newReplicas => {
    replicas = newReplicas
    reconcileReplicaStatusesHandler(replicas, deployments, jobs, logger)
  })

  logger.info("Replica status reconciliation loop setup complete")
}
