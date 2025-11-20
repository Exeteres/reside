import type {
  KubernetesSentinelData,
  OptionalKubernetesManagedObjectCollection,
} from "@contracts/kubernetes-sentinel.v1"
import type { IDeployment } from "kubernetes-models/apps/v1"
import type { Logger } from "pino"
import { ok } from "node:assert"
import { type AlphaData, Replica } from "@contracts/alpha.v1"
import { singleConcurrencyFireAndForget } from "@reside/shared"
import { co } from "jazz-tools"
import { isNonNull } from "remeda"

const LoadedReplicaCollection = co.list(Replica)

type LoadedReplicaCollection = co.loaded<
  typeof LoadedReplicaCollection,
  { $each: { management: true; currentVersion: true; versions: { $each: true } } }
>

const reconcileKubernetesDeployments = singleConcurrencyFireAndForget(
  (
    replicas: LoadedReplicaCollection,
    deployments: OptionalKubernetesManagedObjectCollection<IDeployment>,
    logger: Logger,
  ) => {
    const replicasWithLatestDeployments = replicas
      .map(replica => {
        if (!replica.currentVersion) {
          // not fully created yet
          return null
        }

        if (replica.info.class !== "long-running") {
          return null
        }

        if (!replica.currentVersion.$isLoaded) {
          logger.warn(
            `failed to load current version of replica "%s" while reconciling deployments: %s`,
            replica.name,
            replica.currentVersion.$jazz.loadingState,
          )

          return null
        }

        const deployment = deployments[`${replica.name}-${replica.currentVersion.id}`]
        if (!deployment) {
          logger.warn(
            `no deployment found for replica "%s" version "%d"`,
            replica.name,
            replica.currentVersion.id,
          )

          return null
        }

        return {
          replica,
          deployment,
        }
      })
      .filter(isNonNull)

    const replicasWithReadyLatestDeployments = replicasWithLatestDeployments.filter(
      ({ replica, deployment }) => {
        if (!deployment.$isLoaded) {
          logger.warn(
            `failed to load deployment for replica "%s" version "%d": %s`,
            replica.name,
            replica.currentVersion!.id,
            deployment.$jazz.loadingState,
          )

          return false
        }

        const conditions = deployment.live?.status?.conditions || []

        return conditions.some(
          condition => condition.type === "Available" && condition.status === "True",
        )
      },
    )

    // for each replica with a ready latest deployment, downscale old deployments
    // latest replicas with 0 replicas will also be handled by this logic, so their old versions will be downscaled too
    for (const { replica, deployment } of replicasWithReadyLatestDeployments) {
      const oldVersions = replica.versions.filter(
        version => version.id !== replica.currentVersion!.id,
      )

      let hasOldDeployments = false

      for (const oldVersion of oldVersions) {
        const oldDeployment = deployments[`${replica.name}-${oldVersion.id}`]
        if (!oldDeployment) {
          continue
        }

        ok(oldDeployment.$isLoaded, "old deployment should be loaded here")

        if (!oldDeployment.manifest?.spec?.replicas || oldDeployment.manifest.spec.replicas === 0) {
          continue
        }

        if (oldDeployment.live?.status?.replicas && oldDeployment.live.status.replicas > 0) {
          hasOldDeployments = true
        }

        logger.info(
          `downscaling old deployment for replica "%s" version "%d"`,
          replica.name,
          oldVersion.id,
        )

        oldDeployment.$jazz.set("manifest", {
          ...oldDeployment.manifest!,

          spec: {
            ...oldDeployment.manifest!.spec!,
            replicas: 0,
          },
        })

        oldDeployment.$jazz.set("status", "requested")
      }

      ok(deployment.$isLoaded, "deployment should be loaded here")

      if (typeof replica.management.enabled !== "boolean") {
        logger.warn(
          `replica "%s" has invalid management.enabled value: %o`,
          replica.name,
          replica.management.enabled,
        )
        continue
      }

      if (
        !hasOldDeployments &&
        deployment.manifest?.spec?.replicas === 0 &&
        replica.management.enabled
      ) {
        // if the replica was not started immediately due to being non-scalable, start it now when all old versions are down

        logger.info(
          `upscaling latest deployment for replica "%s" version "%d", all old deployments are confirmed down`,
          replica.name,
          replica.currentVersion!.id,
        )

        deployment.$jazz.set("manifest", {
          ...deployment.manifest!,

          spec: {
            ...deployment.manifest!.spec!,
            replicas: 1,
          },
        })

        deployment.$jazz.set("status", "requested")
      }

      if (
        deployment.manifest?.spec?.replicas &&
        deployment.manifest.spec.replicas > 0 &&
        !replica.management.enabled
      ) {
        // if the replica was disabled, downscale it

        logger.info(
          `downscaling latest deployment for replica "%s" version "%d", replica is disabled`,
          replica.name,
          replica.currentVersion!.id,
        )

        deployment.$jazz.set("manifest", {
          ...deployment.manifest!,

          spec: {
            ...deployment.manifest!.spec!,
            replicas: 0,
          },
        })

        deployment.$jazz.set("status", "requested")
      }
    }
  },
)

/**
 * Setup the reconciliation loop for Kubernetes deployments.
 * It monitors the status of deployments for latest replica version and downscales old versions when new ones are ready to serve.
 *
 * @param alphaData The Alpha data contract instance.
 * @param k8sData The Kubernetes Sentinel data contract instance.
 * @param logger The logger instance for logging reconciliation activities.
 */
export async function setupKubernetesDeploymentReconciliation(
  alphaData: AlphaData,
  k8sData: KubernetesSentinelData,
  logger: Logger,
): Promise<void> {
  const loadedAlpha = await alphaData.$jazz.ensureLoaded({
    resolve: {
      replicas: {
        $each: {
          management: true,
          currentVersion: true,
          versions: { $each: true },
        },
      },
    },
  })

  const loadedK8s = await k8sData.$jazz.ensureLoaded({
    resolve: {
      deployments: {
        // catch since some deployments may be created by other accounts
        $each: { $onError: "catch" },
      },
    },
  })

  let replicas = loadedAlpha.replicas
  let deployments = loadedK8s.deployments

  loadedK8s.deployments.$jazz.subscribe(newDeployments => {
    deployments = newDeployments

    reconcileKubernetesDeployments(replicas, deployments, logger)
  })

  loadedAlpha.replicas.$jazz.subscribe(newReplicas => {
    replicas = newReplicas

    reconcileKubernetesDeployments(replicas, deployments, logger)
  })

  logger.info("Kubernetes deployment reconciliation loop setup complete")
}
