import { ContractEntity, PermissionEntity } from "@contracts/alpha.v1"
import { User } from "@contracts/user-manager.v1"
import { co, z } from "jazz-tools"

/**
 * Represents a grant permission session for tracking the state of the permission granting process.
 *
 * This is used to pass data between callback steps without exceeding Telegram's 64-byte callback data limit.
 */
export const GrantSession = co.map({
  /**
   * The user to grant permission to.
   */
  targetUser: User,

  /**
   * The contract entity for which permission is being granted.
   */
  contract: ContractEntity.optional(),

  /**
   * The permission entity to grant.
   */
  permission: PermissionEntity.optional(),

  /**
   * Current step in the grant process.
   */
  step: z.enum(["select-user", "select-contract", "select-permission", "completed"]),
})

export type GrantSession = co.loaded<typeof GrantSession>
