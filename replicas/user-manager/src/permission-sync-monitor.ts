import type { AlphaData, GrantedPermissionSet } from "@contracts/alpha.v1"
import type { UserManagerData } from "@contracts/user-manager.v1"
import type { Logger } from "pino"
import { type GrantedPermissionSetList, User } from "@contracts/user-manager.v1"
import { syncControlBlockPermissions } from "@replicas/alpha"
import { singleConcurrencyFireAndForget } from "@reside/shared"
import { co } from "jazz-tools"

const PERMISSION_SET_RESOLVE = {
  contract: true,
  replicas: { $each: true },
  permissions: {
    $each: {
      permission: true,
    },
  },
} as const

const UsersCollection = co.list(User)

type LoadedUsersCollection = co.loaded<
  typeof UsersCollection,
  {
    $each: {
      account: { profile: true }
      permissionSets: { $each: typeof PERMISSION_SET_RESOLVE }
    }
  }
>

type LoadedUser = LoadedUsersCollection[number]

type LoadedPermissionSetCollection = co.loaded<
  typeof GrantedPermissionSetList,
  { $each: typeof PERMISSION_SET_RESOLVE }
>

type LoadedPermissionSet = LoadedPermissionSetCollection[number]

export async function setupPermissionSyncMonitor(
  userManagerData: UserManagerData,
  alphaData: AlphaData,
  logger: Logger,
): Promise<void> {
  const loadedData = await userManagerData.$jazz.ensureLoaded({
    resolve: {
      users: {
        $each: {
          account: { profile: true },
          permissionSets: { $each: PERMISSION_SET_RESOLVE },
        },
      },
      defaultPermissionSets: { $each: PERMISSION_SET_RESOLVE },
    },
  })

  let users = loadedData.users as LoadedUsersCollection
  let defaultPermissionSets = loadedData.defaultPermissionSets as LoadedPermissionSetCollection

  const runSync = singleConcurrencyFireAndForget(
    async (currentUsers: LoadedUsersCollection, currentDefaults: LoadedPermissionSetCollection) => {
      await runPermissionSync(alphaData, currentUsers, currentDefaults, logger)
    },
  )

  const scheduleSync = (): void => {
    runSync(users, defaultPermissionSets)
  }

  loadedData.users.$jazz.subscribe(newUsers => {
    users = newUsers as LoadedUsersCollection
    scheduleSync()
  })

  loadedData.defaultPermissionSets.$jazz.subscribe(newDefaults => {
    defaultPermissionSets = newDefaults as LoadedPermissionSetCollection
    scheduleSync()
  })

  logger.info("Permission sync monitor setup complete")
}

export async function runPermissionSync(
  alphaData: AlphaData,
  users: LoadedUsersCollection,
  defaultPermissionSets: LoadedPermissionSetCollection,
  logger: Logger,
  syncFn: typeof syncControlBlockPermissions = syncControlBlockPermissions,
): Promise<void> {
  const defaults = extractPermissionSets(defaultPermissionSets.values())

  for (const user of users.values() as Iterable<LoadedUser | null>) {
    if (!user || !user.$isLoaded || !user.permissionSets.values) {
      continue
    }

    const accountId = user.account.$jazz.id
    const userSets = extractPermissionSets(user.permissionSets.values())
    const combinedPermissionSets: GrantedPermissionSet[] = [...defaults, ...userSets]

    try {
      await syncFn(alphaData, user.account, combinedPermissionSets, logger)
    } catch (err) {
      logger.error(
        {
          err,
          userId: user.id,
          accountId,
        },
        "failed to synchronize user permissions",
      )
    }
  }
}

function extractPermissionSets(
  permissionSets: Iterable<LoadedPermissionSet | null | undefined>,
): GrantedPermissionSet[] {
  const result: GrantedPermissionSet[] = []

  for (const permissionSet of permissionSets) {
    if (!permissionSet || !permissionSet.$isLoaded) {
      continue
    }

    result.push(permissionSet)
  }

  return result
}
