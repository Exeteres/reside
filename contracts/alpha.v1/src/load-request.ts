import type { AlphaData } from "./contract"
import { EventEmitter, on } from "node:events"
import { LocalizedDisplayInfo, loadBoxed, ReplicaInfo } from "@reside/shared"
import { co, z } from "jazz-tools"
import { ContractEntity } from "./contract-entity"
import { Replica, ReplicaRequirement } from "./replica"

export type ReplicaLoadApproveRequest = co.loaded<typeof ReplicaLoadApproveRequest>
export type ReplicaLoadRequest = co.loaded<typeof ReplicaLoadRequest>
export type CreateLoadRequestInput = z.infer<typeof CreateLoadRequestInput>

export const ReplicaPreResolvedRequirement = co.map({
  ...ReplicaRequirement.shape,

  /**
   * The list of alternative replicas that can satisfy the contract requirement.
   */
  alternatives: co.list(Replica),
})

export const CreateLoadRequestInput = z.object({
  /**
   * The image of the replica to load.
   */
  image: z.string(),

  /**
   * The ID of the replica to update instead of creating a new one.
   *
   * Only makes sense for non-exclusive replicas.
   * For exclusive replicas, existing replica will always be updated.
   */
  replicaId: z.number().optional(),

  /**
   * The name to request for the replica.
   *
   * It is not guaranteed that the replica will be assigned this name,
   * as the name must be unique across all replicas in the cluster.
   */
  name: z.string().optional(),

  /**
   * The ID of the owner account that will own the loaded replica.
   *
   * If not set, defaults to the account created the load request.
   */
  ownerId: z.string().optional(),
})

export const ReplicaLoadApproveRequest = co.map({
  /**
   * The static info of the replica to be loaded.
   */
  info: ReplicaInfo,

  /**
   * The resolved name of the replica not conflicting with existing replicas.
   */
  name: z.string(),

  /**
   * The resolved identity of the replica to be loaded.
   */
  identity: z.string(),

  /**
   * The resolved image digest which will be used for deployment.
   */
  digest: z.string(),

  /**
   * The display information of the replica per locale.
   *
   * The key is BCP 47 language tag (e.g., "en", "fr", "de") and the value is the display information in that language.
   */
  displayInfo: LocalizedDisplayInfo,

  /**
   * The contracts implemented by the replica.
   */
  implementations: co.record(z.string(), ContractEntity),

  /**
   * The resolved contracts will be used to satisfy the replica's requirements.
   */
  requirements: co.record(z.string(), ReplicaPreResolvedRequirement),
})

export const ReplicaLoadRequestStatus = z.enum([
  /**
   * The Alpha Replica has received the load request and fetching metadata about the replica.
   */
  "validating",

  /**
   * The Alpha Replica reported that the load request is invalid.
   *
   * Either the image is malformed/unreachable, or the parameters are incorrect.
   */
  "invalid",

  /**
   * The Alpha Replica validated the request and waits for approval to proceed with loading.
   */
  "requires-approval",

  /**
   * The request was rejected and will not be processed.
   */
  "rejected",

  /**
   * The request was approved and the Alpha Replica created the replica in the cluster.
   */
  "approved",
])

export const ReplicaLoadRequest = co.map({
  /**
   * The sequential ID of the load request assigned by the Alpha Replica.
   */
  id: z.number(),

  /**
   * The current status of the load request.
   */
  status: ReplicaLoadRequestStatus,

  /**
   * The image requested to load the replica from.
   */
  image: z.string(),

  /**
   * The resolved owner of the replica to be loaded.
   */
  owner: co.account(),

  /**
   * The name requested for the replica.
   */
  requestedName: z.string().optional(),

  /**
   * The existing replica to be updated instead of creating a new one.
   */
  get existingReplica() {
    return co.optional(Replica)
  },

  /**
   * The associated approve request for `requires-approval`, `approved` and `rejected` statuses.
   */
  approveRequest: ReplicaLoadApproveRequest.optional(),

  /**
   * The error message if the request is in `invalid` status.
   */
  errorMessage: z.string().optional(),

  /**
   * The rejection reason if the request is in `rejected` status.
   */
  rejectionReason: z.string().optional(),
})

/**
 * Returns the load request with the given ID, or null if not found or access is denied.
 *
 * Requires `load-request:read:all` permission on the Alpha Replica.
 *
 * @param alphaData The alpha contract data.
 * @param loadRequestId The ID of the load request to retrieve.
 */
export async function getLoadRequestById(
  alphaData: AlphaData,
  loadRequestId: number,
): Promise<ReplicaLoadRequest | null> {
  return await loadBoxed(
    ReplicaLoadRequest,
    `load-request.by-id.${loadRequestId}`,
    alphaData.$jazz.owner.$jazz.id,
    alphaData.$jazz.loadedAs,
  )
}

/**
 * Waits for the load request to be validated or approved/rejected.
 *
 * Streams updates to the load request as they occur.
 * Finishes when the load request reaches one of the statuses:
 *
 * - `requires-approval`
 * - `approved`
 * - `rejected`
 * - `invalid`
 *
 * Requires `load-request:read:all` or `load-request:approve` permission on the Alpha Replica.
 *
 * @param alphaData The Alpha Replica data.
 * @param inboxRequest The inbox load request to track.
 */
export async function* waitForLoadRequestValidation(
  alphaData: AlphaData,
  loadRequestId: number,
): AsyncIterable<ReplicaLoadRequest> {
  const loadRequest = await getLoadRequestById(alphaData, loadRequestId)

  if (!loadRequest) {
    throw new Error(`Load request with ID ${loadRequestId} not found`)
  }

  if (loadRequest.status !== "validating") {
    yield loadRequest
    return
  }

  const ee = new EventEmitter<{ update: [ReplicaLoadRequest] }>()

  const unsubscribe = loadRequest.$jazz.subscribe(async loadRequest => {
    ee.emit("update", loadRequest)
  })

  for await (const [event] of on(ee, "update") as AsyncIterable<[ReplicaLoadRequest]>) {
    yield event

    if (event.status !== "validating") {
      unsubscribe()
      break
    }
  }
}
