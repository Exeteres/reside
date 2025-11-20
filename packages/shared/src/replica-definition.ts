import type { BaseAccountShape } from "jazz-tools"
import { z } from "zod"
import { type Contract, DisplayInfo } from "./contract"

export type SerializedPermissionRequirement = z.infer<typeof SerializedPermissionRequirement>
export type SerializedRequirement = z.infer<typeof SerializedRequirement>
export type SerializedImplementation = z.infer<typeof SerializedImplementation>

export const SerializedPermissionRequirement = z.object({
  name: z.string(),
  instanceId: z.string().optional(),
  params: z.record(z.string(), z.unknown()),
})

export const SerializedImplementation = z.object({
  identity: z.string(),
})

export const SerializedRequirement = z.object({
  identity: z.string(),
  displayInfo: z.record(z.string(), DisplayInfo).optional(),
  optional: z.boolean().optional(),
  multiple: z.boolean().optional(),
  permissions: z.array(SerializedPermissionRequirement),
})

export type ReplicaInfo = z.infer<typeof ReplicaInfo>

export const ReplicaClass = z.enum([
  /**
   * The replica runs a one-shot task and then exits.
   *
   * For example, the Seed Replica is of this class.
   */
  "oneshot",

  /**
   * The replica runs continuously, performing long-running tasks.
   *
   * Most of the replicas in a Reside cluster are of this class.
   */
  "long-running",
])

export const ReplicaInfo = z.object({
  /**
   * The technical name of the replica.
   *
   * For example: `alpha`, `kubernetes-sentinel`, `my-custom-replica`.
   */
  name: z.string(),

  /**
   * The class of the replica, determining its behavior and lifecycle.
   */
  class: ReplicaClass,

  /**
   * Whether the replica is exclusive in the cluster.
   *
   * The exclusive replica is the only instance of its identity allowed to run in the cluster.
   *
   * For example, there can be only one exclusive `alpha` replica in the cluster.
   *
   * But there can be multiple non-exclusive replicas of the same identity running simultaneously.
   * These replicas are often parametrized to perform different tasks.
   *
   * Note: This parameter does not affect on the scallability of the replica within itself.
   * For example, when updating `alpha` replica to a new version, there might be two instances of it running simultaneously during the update process.
   */
  exclusive: z.boolean(),

  /**
   * Whether the replica is scalable.
   *
   * scalable replicas can have multiple physical instances.
   *
   * Both exclusive and non-exclusive replicas can be scalable or non-scalable.
   *
   * When updating a non-scalable replica, there will be downtime as the old instance is terminated and the new instance is started.
   */
  scalable: z.boolean(),
})

export type PermissionRequirement<
  TContract extends Contract = Contract,
  TName extends keyof TContract["permissions"] = keyof TContract["permissions"],
> = z.infer<TContract["permissions"][TName]["params"]> extends Record<string, never>
  ? { name: TName }
  : {
      name: TName
      params: z.infer<TContract["permissions"][TName]["params"]>
    }

export type ContractRequirement<TContract extends Contract = Contract> = {
  /**
   * The contract required by the replica.
   */
  contract: TContract

  /**
   * The display information for this requirement.
   *
   * Can be specified manually to provide more context about why this contract is required.
   * Or can be left empty to inherit from the contract itself.
   */
  displayInfo?: Record<string, DisplayInfo>

  /**
   * Whether the contract is optional and the replica can function without it.
   */
  optional?: boolean

  /**
   * Whether the multiple implementations of this contract can be provided.
   */
  multiple?: boolean

  /**
   * The static permissions to request from this contract.
   */
  permissions?: {
    [K in keyof TContract["permissions"]]: PermissionRequirement<TContract, K>
  }[keyof TContract["permissions"]][]
}

export type ReplicaDefinition<
  TPrivateData extends BaseAccountShape["root"],
  TImplementations extends Record<string, Contract>,
  TRequirements extends Record<string, Contract>,
> = {
  /**
   * The unique identity of the replica.
   */
  identity: string

  /**
   * The static information about the replica.
   */
  info: ReplicaInfo

  /**
   * The display information for the replica.
   */
  displayInfo: Record<string, DisplayInfo>

  /**
   * The private data schema used by the replica.
   */
  privateData?: TPrivateData

  /**
   * The contracts implemented by the replica.
   */
  implementations?: TImplementations

  /**
   * The contracts required by the replica.
   */
  requirements?: { [K in keyof TRequirements]: ContractRequirement<TRequirements[K]> }
}

export function defineReplica<
  TPrivateData extends BaseAccountShape["root"],
  TContracts extends Record<string, Contract>,
  TRequirements extends Record<string, Contract>,
>(
  definition: ReplicaDefinition<TPrivateData, TContracts, TRequirements>,
): ReplicaDefinition<TPrivateData, TContracts, TRequirements> {
  return definition
}
