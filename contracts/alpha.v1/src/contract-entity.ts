import type { AlphaData } from "./contract"
import { LocalizedDisplayInfo, loadBoxed } from "@reside/shared"
import { co, z } from "jazz-tools"

export type ContractEntity = co.loaded<typeof ContractEntity>

/**
 * The entity representing a permission defined by a contract.
 */
export const PermissionEntity = co.map({
  /**
   * The name of the permission within the contract.
   */
  name: z.string(),

  /**
   * The display information for the contract.
   *
   * The key is BCP 47 language tag (e.g., "en", "fr", "de") and the value is the display information in that language.
   */
  displayInfo: LocalizedDisplayInfo,

  /**
   * The list of keys in the params that uniquely identify the permission instance.
   *
   * Will be undefined if the permission does not support multiple instances.
   */
  instanceKeys: z.string().array().optional(),

  /**
   * The JSON schema of the params of this permission.
   *
   * Will be undefined if the permission does not accept any parameters.
   */
  params: z.json().optional(),
})

/**
 * The entity representing a method defined by a contract.
 */
export const MethodEntity = co.map({
  /**
   * The name of the method within the contract.
   */
  name: z.string(),

  /**
   * The display information for the method.
   *
   * The key is BCP 47 language tag (e.g., "en", "fr", "de") and the value is the display information in that language.
   */
  displayInfo: LocalizedDisplayInfo,
})

/**
 * The contract entity managed by the Alpha Replica.
 *
 * It first creates when some replica using contract is attempted to be deployed.
 *
 * Unlike replicas, contracts are not versioned, so this entity always tracks the latest fetched version.
 */
export const ContractEntity = co.map({
  /**
   * The registration ID of the contract.
   *
   * It is sequentially assigned when the contract is first created in the cluster.
   *
   * Starts from `1`.
   */
  id: z.number(),

  /**
   * The identity of the contract.
   */
  identity: z.string(),

  /**
   * The display information for the contract.
   *
   * The key is BCP 47 language tag (e.g., "en", "fr", "de") and the value is the display information in that language.
   */
  displayInfo: LocalizedDisplayInfo,

  /**
   * The list of permissions defined by the contract.
   */
  permissions: co.record(z.string(), PermissionEntity),

  /**
   * The list of methods defined by the contract.
   */
  methods: co.record(z.string(), MethodEntity),
})

/**
 * Returns the contract with the given ID, or null if not found or access is denied.
 *
 * @param data The alpha contract data.
 * @param id The ID of the managed contract to retrieve.
 */
export async function getContractEntityById(
  data: AlphaData,
  id: number,
): Promise<ContractEntity | null> {
  return await loadBoxed(
    ContractEntity,
    `contract.by-id.${id}`,
    data.$jazz.owner.$jazz.id,
    data.$jazz.loadedAs,
  )
}

/**
 * Returns the contract with the given identity, or null if not found or access is denied.
 *
 * @param data The alpha contract data.
 * @param identity The identity of the managed contract to retrieve.
 */
export async function getContractEntityByIdentity(
  data: AlphaData,
  identity: string,
): Promise<ContractEntity | null> {
  return await loadBoxed(
    ContractEntity,
    `contract.by-identity.${identity}`,
    data.$jazz.owner.$jazz.id,
    data.$jazz.loadedAs,
  )
}
