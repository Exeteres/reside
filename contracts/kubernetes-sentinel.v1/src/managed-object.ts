import { typedJson } from "@reside/shared"
import { co, z } from "jazz-tools"

export const ManagedObjectStatus = z.enum([
  /**
   * The object is requested to be created or updated by some replica.
   *
   * In this state, the Kubernetes Sentinel will attempt to create or update the object in the cluster.
   *
   * When other replicas update `manifest`, they must explicitly set status to `requested` to signal that the change needs to be applied.
   */
  "requested",

  /**
   * The update has been applied successfully.
   *
   * It does not mean that the live state matches the desired manifest, only that the request to change it was accepted by the Kubernetes API.
   *
   * Client replicas should monitor the `live` field to determine when the desired state is actually reached.
   */
  "updated",

  /**
   * The object failed to be created or updated.
   *
   * The `errorMessage` field will contain more details about the failure.
   */
  "error",
])

export function KubernetesManagedObject<T>() {
  return co.map({
    /**
     * The name of the Kubernetes object.
     */
    name: z.string(),

    /**
     * The current status of the managed object.
     */
    status: ManagedObjectStatus,

    /**
     * The desired manifest of the Kubernetes object.
     *
     * If `null`, the object is requested to be deleted.
     */
    manifest: typedJson<T>().nullable(),

    /**
     * The live manifest of the Kubernetes object as observed in the cluster.
     */
    live: typedJson<T>().optional(),

    /**
     * The message of the last error encountered when trying to apply the manifest.
     *
     * Will be set only if status is `error`.
     */
    errorMessage: z.string().optional(),
  })
}

export function KubernetesManagedObjectCollection<T>() {
  return co.record(z.string(), KubernetesManagedObject<T>())
}

export type ManagedObjectStatus = z.infer<typeof ManagedObjectStatus>
export type KubernetesManagedObject<T> = co.loaded<ReturnType<typeof KubernetesManagedObject<T>>>
export type KubernetesManagedObjectCollection<T> = co.loaded<
  ReturnType<typeof KubernetesManagedObjectCollection<T>>,
  { $each: true }
>

export type OptionalKubernetesManagedObjectCollection<T> = co.loaded<
  ReturnType<typeof KubernetesManagedObjectCollection<T>>,
  { $each: { $onError: "catch" } }
>

/**
 * Updates or creates a managed object manifest in the collection.
 *
 * If the object already exists, its status is set to `requested` and the manifest is updated.
 * If it does not exist, a new object is created with the given name, status `requested`, and the provided manifest.
 *
 * @param collection The collection of managed objects.
 * @param name The name of the managed object to update or create.
 * @param manifest The desired manifest of the managed object, or `null` to request deletion.
 */
export function updateManagedObjectManifest<T>(
  collection: OptionalKubernetesManagedObjectCollection<T>,
  name: string,
  manifest: T | null,
): void {
  const existing = collection[name]

  if (existing) {
    if (!existing.$isLoaded) {
      throw new Error(
        `Managed kubernetes object "${name}" could not be updated: ${existing.$jazz.loadingState}`,
      )
    }

    existing.$jazz.set("status", "requested")
    // biome-ignore lint/suspicious/noExplicitAny: idk why
    existing.$jazz.set("manifest", manifest as any)

    return
  }

  collection.$jazz.set(name, {
    name,
    status: "requested",
    manifest: manifest,
    // biome-ignore lint/suspicious/noExplicitAny: idk why
  } as any)
}
