import type { UserManagerData } from "./contract"
import {
  type ContractEntity,
  type GrantedPermission,
  GrantedPermissionSet,
  type Replica,
} from "@contracts/alpha.v1"
import { loadBoxed } from "@reside/shared"
import { type Account, co, z } from "jazz-tools"
import { Realm } from "./realm"

export type User = co.loaded<typeof User>
export type GrantedPermissionSetList = co.loaded<typeof GrantedPermissionSetList>

export const GrantedPermissionSetList = co.list(GrantedPermissionSet)

export const AccountCredentials = co.map({
  /**
   * The secret key of the account, used for authentication.
   */
  agentSecret: z.string(),
})

export const User = co.map({
  /**
   * The sequential unique identifier of the user.
   *
   * Assigned when the user requests registration.
   */
  id: z.number(),

  /**
   * The account of the user.
   */
  account: co.account(),

  /**
   * The realm the user belongs to.
   */
  get realm() {
    return Realm
  },

  /**
   * Whether the user account credentials are managed by the User Manager, or by the user themselves.
   */
  isManaged: z.boolean(),

  /**
   * The list of permission sets assigned to the user.
   */
  permissionSets: GrantedPermissionSetList,

  /**
   * The credentials for the user's account, if managed by the User Manager.
   *
   * Only accessible by accounts with "user:impersonate:all" permission.
   */
  credentials: AccountCredentials.optional(),
})

/**
 * Gets the user by their unique identifier.
 *
 * @param data The User Manager contract data.
 * @param userId The unique identifier of the user.
 * @returns The user if found, otherwise null.
 */
export async function getUserById(data: UserManagerData, userId: number): Promise<User | null> {
  return await loadBoxed(
    User,
    `user.by-id.${userId}`,
    data.$jazz.owner.$jazz.id,
    data.$jazz.loadedAs,
  )
}

/**
 * Gets the user by their account identifier.
 *
 * @param data The User Manager contract data.
 * @param accountId The account identifier of the user.
 * @returns The user if found, otherwise null.
 */
export async function getUserByAccountId(
  data: UserManagerData,
  accountId: string,
): Promise<User | null> {
  return await loadBoxed(
    User,
    `user.by-account.${accountId}`,
    data.$jazz.owner.$jazz.id,
    data.$jazz.loadedAs,
  )
}

/**
 * Gets the user corresponding to the current loaded account.
 *
 * @param data The User Manager contract data.
 * @returns The user if found, otherwise null.
 */
export async function getMe(data: UserManagerData): Promise<User | null> {
  const loadedAccount = data.$jazz.loadedAs as Account

  return await getUserByAccountId(data, loadedAccount.$jazz.id)
}

/**
 * Creates a new user permission set and adds it to the collection.
 *
 * @param collection The collection to add the permission set to.
 * @param contract The contract entity representing the permission set.
 * @param replicas The replicas where this permission set is applied.
 * @param permissions The permissions granted by this permission set.
 * @returns The created user permission set.
 */
export async function createGrantedPermissionSet(
  collection: GrantedPermissionSetList,
  contract: ContractEntity,
  replicas: Replica[],
  permissions: GrantedPermission[],
): Promise<GrantedPermissionSet> {
  const permissionSet = GrantedPermissionSet.create({
    contract,
    replicas,
    permissions,
  })

  // ensure all permissions are readable by the parent
  for (const permission of permissions) {
    permission.$jazz.owner.addMember(permissionSet.$jazz.owner, "reader")
  }

  // add the permission set to the collection
  collection.$jazz.push(permissionSet)

  // also ensure that collection readers can read the permission set
  permissionSet.$jazz.owner.addMember(collection.$jazz.owner, "reader")

  return permissionSet
}
