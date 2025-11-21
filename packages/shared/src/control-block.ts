import { type Account, co, z } from "jazz-tools"
import { ControlBlockPermissions } from "./permissions"

export type ReplicaControlBlock = co.loaded<typeof ReplicaControlBlock>

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
