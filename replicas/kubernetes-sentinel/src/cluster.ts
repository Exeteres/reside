import type { KubernetesManagedObjectCollection } from "@contracts/kubernetes-sentinel.v1"
import type { Logger } from "pino"
import type { ObjectType } from "./object-type"
import {
  KubeConfig,
  type KubernetesListObject,
  type KubernetesObject,
  KubernetesObjectApi,
  makeInformer,
} from "@kubernetes/client-node"
import { errorToString } from "@reside/shared"

const sentinelLabelName = "app.kubernetes.io/managed-by"
const sentinelLabelValue = "kubernetes-sentinel"
const sentinelLabelSelector = `${sentinelLabelName}=${sentinelLabelValue}`

export type SyncManagedObjectsOptions = {
  /**
   * When set to true, deletion of objects not managed by any manifest will be skipped.
   *
   * By default, all objects unrecognized by the managed state will be deleted from the cluster.
   * Explicit deletions requested via a `null` manifest are always executed regardless of this flag.
   */
  keepUnmanaged?: boolean
}

export class ClusterAlpha {
  private readonly kc: KubeConfig
  private readonly objectApi: KubernetesObjectApi

  constructor(
    private readonly namespace: string,
    private readonly logger: Logger,
  ) {
    this.kc = new KubeConfig()
    this.kc.loadFromDefault()

    this.objectApi = this.kc.makeApiClient(KubernetesObjectApi)
  }

  /**
   * Syncs the desired managed objects to the Kubernetes cluster.
   *
   * @param current The current state of managed objects to read desired state from.
   * @param objectType The type of Kubernetes object to sync.
   * @param options Additional sync options.
   */
  async syncManagedObjects<T>(
    current: KubernetesManagedObjectCollection<T>,
    objectType: ObjectType,
    options: SyncManagedObjectsOptions = {},
  ): Promise<void> {
    const toUpdate = Object.values(current).filter(obj => obj.status === "requested")

    // query all current objects of the specified type in the cluster
    const result = await this.listObjects<T>(objectType)

    const existingByName = new Map<string, KubernetesObject>()
    for (const item of result.items) {
      const name = item.metadata?.name
      if (!name) {
        continue
      }

      existingByName.set(name, item)
    }

    const registeredNames = new Set(
      Object.values(current)
        .map(obj => obj?.name)
        .filter((name): name is string => typeof name === "string"),
    )

    for (const obj of toUpdate) {
      const existing = existingByName.get(obj.name)

      // 1. delete if exists and manifest is null
      if (obj.manifest === null) {
        if (!existing) {
          if (obj.live !== undefined) {
            // object already deleted from cluster, clear live state
            obj.$jazz.set("live", undefined)

            this.logger.warn(
              `unexpected non-undefined live state for deleted %s "%s", cleared`,
              objectType.kind,
              obj.name,
            )
          }

          registeredNames.delete(obj.name)
          continue
        }

        try {
          await this.objectApi.delete({
            kind: objectType.kind,
            apiVersion: objectType.apiVersion,
            metadata: { name: obj.name, namespace: this.namespace },
          })

          current.$jazz.delete(obj.name)
          registeredNames.delete(obj.name)
          existingByName.delete(obj.name)

          this.logger.info(`deleted %s "%s" from cluster`, objectType.kind, obj.name)
        } catch (err) {
          this.logger.error({ err }, `failed to delete %s "%s"`, objectType.kind, obj.name)

          obj.$jazz.set("status", "error")
          obj.$jazz.set("errorMessage", `failed to delete: ${errorToString(err)}`)
        }

        continue
      }

      const requestedManifest = obj.manifest as KubernetesObject

      // create manifest with some forced values regardless what other replicas set
      const resolvedManifest: KubernetesObject = {
        ...requestedManifest,
        kind: objectType.kind,
        apiVersion: objectType.apiVersion,
        metadata: {
          ...requestedManifest.metadata,
          name: obj.name,
          namespace: this.namespace,
          labels: {
            ...requestedManifest.metadata?.labels,
            [sentinelLabelName]: sentinelLabelValue,
          },
        },
      }

      // 2. update if exists
      if (existing) {
        try {
          await this.objectApi.patch(
            resolvedManifest,
            undefined,
            undefined,
            sentinelLabelValue,
            undefined,
            "application/apply-patch+yaml",
          )

          obj.$jazz.set("status", "updated")
          existingByName.delete(obj.name)

          this.logger.info(`updated %s "%s" in cluster`, objectType.kind, obj.name)
        } catch (err) {
          this.logger.error({ err }, `failed to update %s "%s"`, objectType.kind, obj.name)

          obj.$jazz.set("status", "error")
          obj.$jazz.set("errorMessage", `failed to update: ${errorToString(err)}`)
        }

        continue
      }

      // 3. create if does not exist
      if (!existing && obj.manifest !== null) {
        try {
          await this.objectApi.patch(
            resolvedManifest,
            undefined,
            undefined,
            sentinelLabelValue,
            undefined,
            "application/apply-patch+yaml",
          )

          obj.$jazz.set("status", "updated")
          registeredNames.add(obj.name)

          this.logger.info(`created %s "%s" in cluster`, objectType.kind, obj.name)
        } catch (err) {
          this.logger.error({ err }, `failed to create %s "%s"`, objectType.kind, obj.name)

          obj.$jazz.set("status", "error")
          obj.$jazz.set("errorMessage", `failed to create: ${errorToString(err)}`)
        }
      }
    }

    if (!options.keepUnmanaged) {
      for (const [name] of existingByName) {
        if (registeredNames.has(name)) {
          continue
        }

        try {
          await this.objectApi.delete({
            kind: objectType.kind,
            apiVersion: objectType.apiVersion,
            metadata: { name, namespace: this.namespace },
          })

          this.logger.info(`deleted unmanaged %s "%s" from cluster`, objectType.kind, name)
        } catch (err) {
          this.logger.error({ err }, `failed to delete unmanaged %s "%s"`, objectType.kind, name)
        }
      }
    }
  }

  /**
   * Sets up a watcher to monitor changes in the cluster for the specified object type.
   * If changes are detected, the current managed objects are updated accordingly.
   *
   * @param current The current state of managed objects to write back to.
   * @param objectType The type of Kubernetes object to watch.
   * @returns An AsyncDisposable that can be used to stop the watcher.
   */
  setupWatcher<T>(
    current: KubernetesManagedObjectCollection<T>,
    objectType: ObjectType,
  ): AsyncDisposable {
    const basePath = objectType.apiVersion === "v1" ? "/api" : "/apis"
    const path = `${basePath}/${objectType.apiVersion}/namespaces/${this.namespace}/${objectType.plural}`

    const informer = makeInformer(
      this.kc,
      path,
      () => this.listObjects<T>(objectType),
      sentinelLabelSelector,
    )

    const handleEvent = async (obj: KubernetesObject, deletion: boolean) => {
      if (!obj.metadata?.name) {
        this.logger.warn(`updated %s with no name, ignoring`, objectType.kind)
        return
      }

      this.logger.info(`detected update of %s "%s"`, objectType.kind, obj.metadata?.name)

      const managedObj = current[obj.metadata.name]
      if (!managedObj) {
        this.logger.warn(
          `%s "%s" updated in cluster but not managed in current state, ignoring`,
          objectType.kind,
          obj.metadata?.name,
        )
        return
      }

      // update the live state
      if (deletion) {
        managedObj.$jazz.set("live", undefined)
      } else {
        // biome-ignore lint/suspicious/noExplicitAny: generic usage
        managedObj.$jazz.set("live", obj as any)
      }

      // if not erroring, reset status to updated
      if (managedObj.status !== "error") {
        managedObj.$jazz.set("status", "updated")
      }
    }

    informer.on("add", obj => handleEvent(obj, false))
    informer.on("update", obj => handleEvent(obj, false))
    informer.on("delete", obj => handleEvent(obj, true))

    void informer.start()

    return {
      [Symbol.asyncDispose]: async () => {
        try {
          await informer.stop()
        } catch (err) {
          this.logger.error({ err }, `failed to stop informer for %s`, objectType.kind)
        }
      },
    }
  }

  private async listObjects<T>(
    objectType: ObjectType,
  ): Promise<KubernetesListObject<T & KubernetesObject>> {
    return await this.objectApi.list(
      objectType.apiVersion,
      objectType.kind,
      this.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      sentinelLabelSelector,
    )
  }
}
