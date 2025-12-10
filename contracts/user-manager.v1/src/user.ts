import type { UserManagerData } from "./contract"
import {
  type ContractEntity,
  GrantedPermission,
  GrantedPermissionSet,
  type PermissionEntity,
  type Replica,
} from "@contracts/alpha.v1"
import { loadBoxed } from "@reside/shared"
import { type Account, co, Group, z } from "jazz-tools"
import { Realm } from "./realm"

export type User = co.loaded<typeof User>
export type GrantedPermissionSetList = co.loaded<typeof GrantedPermissionSetList>
export type PermissionGrantResult = { action: "added" | "created" | "duplicate" }

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
  const permissionSet = GrantedPermissionSet.create(
    {
      contract,
      replicas,
      permissions,
    },
    collection.$jazz.owner,
  )

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

export async function grantPermissionToPermissionSetList(
  permissionSets: GrantedPermissionSetList,
  contractEntity: ContractEntity,
  permission: co.loaded<typeof PermissionEntity>,
  replicas: Replica[],
  ownerAccount: Account,
  params: Record<string, unknown> = {},
): Promise<PermissionGrantResult> {
  if (!permissionSets.$isLoaded) {
    throw new Error("Permission sets collection is not loaded")
  }

  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new Error("Permission params must be a plain object")
  }

  const normalizedParams = params
  const instanceKeys = permission.instanceKeys ?? []
  let instanceId: string | undefined

  if (instanceKeys.length > 0) {
    const parts = instanceKeys.map(key => {
      if (!(key in normalizedParams)) {
        throw new Error(
          `Permission "${permission.name}" requires parameter "${key}" to determine instance ID`,
        )
      }

      const value = normalizedParams[key]

      if (value === null || value === undefined) {
        throw new Error(
          `Permission "${permission.name}" parameter "${key}" must not be null or undefined to determine instance ID`,
        )
      }

      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value)
      }

      throw new Error(
        `Permission "${permission.name}" parameter "${key}" must be a string, number, or boolean to determine instance ID`,
      )
    })

    instanceId = parts.join(".")
  }

  let existingPermissionSet: GrantedPermissionSet | undefined

  for (const permissionSet of permissionSets.values()) {
    if (!permissionSet.$isLoaded) {
      continue
    }

    if (!permissionSet.contract?.$isLoaded) {
      continue
    }

    if (permissionSet.contract.id === contractEntity.id) {
      existingPermissionSet = permissionSet
      break
    }
  }

  const newPermission = GrantedPermission.create(
    {
      requestType: "manual",
      status: "approved",
      permission,
      instanceId,
      // biome-ignore lint/suspicious/noExplicitAny: idk why
      params: normalizedParams as any,
    },
    Group.create(ownerAccount),
  )

  if (existingPermissionSet?.$isLoaded) {
    if (!existingPermissionSet.permissions.$isLoaded) {
      throw new Error("Permission set's permissions are not loaded")
    }

    let alreadyExists = false
    for (const granted of existingPermissionSet.permissions.values()) {
      if (!granted.$isLoaded) {
        continue
      }

      if (granted.permission?.$isLoaded && granted.permission.name === permission.name) {
        const existingInstanceId = granted.instanceId ?? undefined

        if (instanceKeys.length === 0) {
          alreadyExists = !existingInstanceId
        } else {
          alreadyExists = existingInstanceId === instanceId
        }

        if (alreadyExists) {
          break
        }
      }
    }

    if (alreadyExists) {
      return { action: "duplicate" }
    }

    newPermission.$jazz.owner.addMember(existingPermissionSet.$jazz.owner, "reader")
    existingPermissionSet.permissions.$jazz.push(newPermission)

    return { action: "added" }
  }

  await createGrantedPermissionSet(permissionSets, contractEntity, replicas, [newPermission])

  return { action: "created" }
}

/**
 * Grants a permission to a user by either adding it to an existing permission set for the contract or creating a new one.
 *
 * This function checks if the user already has a permission set for the given contract.
 * If found, it adds the permission to the existing set (if not already present).
 * Otherwise, it creates a new permission set.
 *
 * @param user The user to grant the permission to. Must have permissionSets loaded with contract and permissions resolved.
 * @param contractEntity The contract entity for which the permission is being granted.
 * @param permission The permission entity to grant.
 * @param replicas The replicas implementing the contract.
 * @returns An object indicating whether the permission was added to an existing set, created in a new set, or already existed.
 */
export async function grantPermissionToUser(
  user: User,
  contractEntity: ContractEntity,
  permission: co.loaded<typeof PermissionEntity>,
  replicas: Replica[],
  params: Record<string, unknown> = {},
): Promise<PermissionGrantResult> {
  // verify permission sets are loaded
  if (!user.permissionSets.$isLoaded) {
    throw new Error("User's permission sets are not loaded")
  }

  return await grantPermissionToPermissionSetList(
    user.permissionSets,
    contractEntity,
    permission,
    replicas,
    user.$jazz.loadedAs as Account,
    params,
  )
}
