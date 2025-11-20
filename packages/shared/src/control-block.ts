import { type Account, co, z } from "jazz-tools"
import { ControlBlockPermissions } from "./permissions"

export type ReplicaControlBlock = co.loaded<typeof ReplicaControlBlock>
export type ControlBlockRequirement = co.loaded<typeof ControlBlockRequirement>

export const ControlBlockRequirement = co
  .map({
    /**
     * The data object of the requirement's contract.
     */
    data: co.map({}),

    /**
     * The ID of the account of the replica implementing this requirement.
     */
    accountId: z.string(),

    /**
     * The base URL for calling methods on this requirement.
     *
     * Will not be set for requirements that are not services (does not expose methods).
     */
    baseUrl: z.string().optional(),
  })
  .resolved({ data: true })

/**
 * The control block is per-replica structure writable by both: Alpha Replica and the replica itself.
 *
 * This structure is created and owned by Alpha Replica, but it shares write access with the replica account.
 */
export const ReplicaControlBlock = co
  .map({
    /**
     * The id of the replica assigned by Alpha Replica.
     */
    id: z.number(),

    /**
     * The name of the replica assigned by Alpha Replica.
     */
    name: z.string(),

    /**
     * The IDs of the replica accounts implementing the requirements.
     */
    requirements: z.record(z.string(), z.string().array()),

    /**
     * The permissions of this replica.
     */
    permissions: ControlBlockPermissions,
  })
  .resolved({
    permissions: { $each: { account: true } },
  })

/**
 * Loads the Replica Control Block with the given ID.
 *
 * @param id The ID of the Replica Control Block to load.
 * @param loadAs Optional account to load the control block as.
 * @returns The loaded Replica Control Block.
 */
export async function loadControlBlock(id: string, loadAs?: Account): Promise<ReplicaControlBlock> {
  const controlBlock = await ReplicaControlBlock.load(id, { loadAs })

  if (!controlBlock.$isLoaded) {
    throw new Error(`Replica Control Block with ID ${id} not found`)
  }

  return controlBlock
}
