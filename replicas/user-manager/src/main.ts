import { AlphaContract } from "@contracts/alpha.v1"
import {
  AccountCredentials,
  getRealmByName,
  getUserByAccountId,
  UserManagerContract,
} from "@contracts/user-manager.v1"
import { createPermissionSet, createSuperAdminPermissionSet } from "@replicas/alpha"
import { CommonReplicaConfig, loadConfig, startReplica } from "@reside/shared"
import { createWorkerAccount } from "jazz-run/createWorkerAccount"
import { type Account, co, JazzRequestError } from "jazz-tools"
import { setupPermissionSyncMonitor } from "./permission-sync-monitor"
import { UserManagerReplica } from "./replica"
import { createUser } from "./user"

const {
  implementations: { userManager },
  requirements: { alpha },
  replicaId,
  lockService,
  logger,
} = await startReplica(UserManagerReplica)

const loadedUserManager = await userManager.data.$jazz.ensureLoaded({
  resolve: {
    defaultPermissionSets: true,
  },
})

if (loadedUserManager.defaultPermissionSets.length === 0) {
  logger.info("populating default permission sets")

  const alphaPermissionSet = await createPermissionSet(
    alpha.data,
    alpha.replicaId,
    AlphaContract.identity,
    [
      // warning: will break everything if removed
      "replica:read:all",
    ],
    userManager.data.$jazz.loadedAs as Account,
  )

  const umPermissionSet = await createPermissionSet(
    alpha.data,
    replicaId,
    UserManagerContract.identity,
    [
      // warning: will break everything if removed
      "default-permissions:read",
    ],
    userManager.data.$jazz.loadedAs as Account,
  )

  loadedUserManager.defaultPermissionSets.$jazz.push(alphaPermissionSet)
  loadedUserManager.defaultPermissionSets.$jazz.push(umPermissionSet)

  // inherit read access from the collection
  alphaPermissionSet.$jazz.owner.addMember(
    loadedUserManager.defaultPermissionSets.$jazz.owner,
    "reader",
  )
  umPermissionSet.$jazz.owner.addMember(
    loadedUserManager.defaultPermissionSets.$jazz.owner,
    "reader",
  )
}

const loadedAlphaData = await alpha.data.$jazz.ensureLoaded({
  resolve: {
    superAdminAccount: true,
  },
})

userManager.handleRegister(async ({}, madeBy) => {
  return await lockService.transaction(UserManagerContract.data, userManager.data, async data => {
    const loadedData = await data.$jazz.ensureLoaded({
      resolve: {
        users: true,
        defaultRealm: true,
        managePermissionsGroup: true,
      },
    })

    const existingUser = await getUserByAccountId(loadedData, madeBy.$jazz.id)

    // for already registered users, return existing user
    if (existingUser) {
      return { user: existingUser }
    }

    const user = await createUser(data, madeBy)
    const loadedUser = await user.$jazz.ensureLoaded({
      resolve: { permissionSets: { $each: true } },
    })

    // if user is super admin, grant them permissions given by alpha replica
    // otherwise they won't be able to access them after first permission sync
    if (loadedAlphaData.superAdminAccount?.$jazz.id === madeBy.$jazz.id) {
      const alphaPermissionSet = await createSuperAdminPermissionSet(
        loadedAlphaData,
        alpha.replicaId,
        data.$jazz.loadedAs as Account,
      )

      // add extra permissions to manage permissions of all users
      const umPermissionSet = await createPermissionSet(
        loadedAlphaData,
        replicaId,
        UserManagerContract.identity,
        [
          //
          "user:read:all",
          "user:permission:manage:all",
          "default-permissions:manage",
        ],
        data.$jazz.loadedAs as Account,
      )

      // inherit read access from the collection
      alphaPermissionSet.$jazz.owner.addMember(loadedUser.permissionSets.$jazz.owner, "reader")
      umPermissionSet.$jazz.owner.addMember(loadedUser.permissionSets.$jazz.owner, "reader")

      // biome-ignore lint/suspicious/noExplicitAny: they are loaded i guess
      loadedUser.permissionSets.$jazz.push(alphaPermissionSet as any, umPermissionSet as any)

      logger.info(
        `granted super admin permissions to new user #%d for account "%s"`,
        loadedUser.id,
        madeBy.$jazz.id,
      )
    }

    logger.info(`registered new user #%d for account "%s"`, loadedUser.id, madeBy.$jazz.id)

    return { user: loadedUser }
  })
})

userManager.handleCreateUser(async ({ realmName, accountName }, madeBy) => {
  if (!userManager.checkPermission(madeBy, "user:create:realm", realmName)) {
    throw new JazzRequestError(
      `Account "${madeBy.$jazz.id}" does not have permission to create users in realm "${realmName}"`,
      403,
    )
  }

  return await lockService.transaction(UserManagerContract.data, userManager.data, async data => {
    const realm = await getRealmByName(data, realmName)
    if (!realm) {
      throw new JazzRequestError(`Realm with name "${realmName}" not found`, 404)
    }

    const loadedRealm = await realm.$jazz.ensureLoaded({ resolve: { impersonateUsersGroup: true } })

    const config = loadConfig(CommonReplicaConfig)

    const { accountID, agentSecret } = await createWorkerAccount({
      name: accountName,
      peer: config.RESIDE_SYNC_SERVER_URL,
    })

    const account = await co.account().load(accountID, { loadAs: data.$jazz.loadedAs })
    if (!account.$isLoaded) {
      throw new Error(
        `Failed to load created account with ID "${accountID}": ${account.$jazz.loadingState}`,
      )
    }

    const user = await createUser(data, account, realm, true)
    const credentials = AccountCredentials.create({ agentSecret })

    user.$jazz.set("credentials", credentials)

    // allow impersonation for realm
    credentials.$jazz.owner.addMember(loadedRealm.impersonateUsersGroup, "reader")

    return { user }
  })
})

await setupPermissionSyncMonitor(userManager.data, loadedAlphaData, logger)

logger.info("User Manager Replica started")
