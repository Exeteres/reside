import type { AgentSecret } from "cojson"
import type { Logger } from "pino"
import type { UserManagerContract } from "./contract"
import type { User } from "./user"
import {
  CommonReplicaConfig,
  type LocalizedDisplayInfo,
  loadConfig,
  type PermissionRequirement,
  type Requirement,
} from "@reside/shared"
import { createWebSocketPeer } from "cojson-transport-ws"
import {
  type Account,
  type AnyAccountSchema,
  co,
  createJazzContextFromExistingCredentials,
  type InstanceOfSchema,
  randomSessionProvider,
} from "jazz-tools"
import { getRealmByName } from "./realm"

export type RealmOptions = {
  /**
   * The name of the realm.
   */
  name: string

  /**
   * The display information for the realm.
   *
   * The key is BCP 47 language tag (e.g., "en", "fr", "de") and the value is the display information in that language.
   */
  displayInfo: LocalizedDisplayInfo
}

export type ImpersonationHandler<TAccount extends Account> = (account: TAccount) => Promise<void>

export type RealmContext = {
  /**
   * The method to update the realm definition based on the options provided.
   *
   * Must be called once at the replica startup.
   *
   * @param userManager The User Manager contract requirement.
   * @param logger The logger instance to use for logging.
   */
  init(userManager: Requirement<UserManagerContract>, logger: Logger): Promise<void>

  /**
   * Creates a new managed user in this realm.
   *
   * @param name The name of the user to create. Not required and not unique.
   */
  createUser(name?: string): Promise<User>

  /**
   * Impersonates the given user.
   *
   * @param accountSchema The schema of the account.
   * @param user The user to impersonate.
   * @param handler The handler to execute while impersonating the user. Passed the impersonated account context.
   */
  impersonate<TAccount extends AnyAccountSchema>(
    accountSchema: TAccount,
    user: User,
    handler: ImpersonationHandler<InstanceOfSchema<TAccount>>,
  ): Promise<void>

  /**
   * Impersonates the given user.
   *
   * Uses the default Account schema.
   *
   * @param user The user to impersonate.
   * @param handler The handler to execute while impersonating the user.
   */
  impersonate(user: User, handler: ImpersonationHandler<Account>): Promise<void>

  /**
   * The static permission requirements that must be passed to user manager contract requirement.
   */
  permissions: {
    /**
     * The all permissions available for this realm.
     */
    all: [
      RealmContext["permissions"]["init"],
      RealmContext["permissions"]["createUsers"],
      RealmContext["permissions"]["readUsers"],
      RealmContext["permissions"]["impersonateUsers"],
    ]

    /**
     * The permission to manage the realm metadata (definition).
     *
     * Mutually exclusive with "realm:read".
     */
    init: PermissionRequirement<UserManagerContract, "realm:manage">

    /**
     * The permission to read the real information.
     *
     * Mutually exclusive with "realm:manage".
     */
    read: PermissionRequirement<UserManagerContract, "realm:read">

    /**
     * The permission to create users in this realm.
     */
    createUsers: PermissionRequirement<UserManagerContract, "user:create:realm">

    /**
     * The permission to read users in this realm.
     */
    readUsers: PermissionRequirement<UserManagerContract, "user:read:realm">

    /**
     * The permission to impersonate users in this realm.
     */
    impersonateUsers: PermissionRequirement<UserManagerContract, "user:impersonate:realm">
  }
}

/**
 * Defines a realm with the given options.
 *
 * @param options The realm options.
 */
export function defineRealm(options: RealmOptions): RealmContext {
  const permissions: Omit<RealmContext["permissions"], "all"> = {
    init: {
      name: "realm:manage",
      params: {
        name: options.name,
      },
    },
    read: {
      name: "realm:read",
      params: {
        name: options.name,
      },
    },
    createUsers: {
      name: "user:create:realm",
      params: {
        realmName: options.name,
      },
    },
    readUsers: {
      name: "user:read:realm",
      params: {
        realmName: options.name,
      },
    },
    impersonateUsers: {
      name: "user:impersonate:realm",
      params: {
        realmName: options.name,
      },
    },
  }

  let _userManager: Requirement<UserManagerContract> | undefined
  let _logger: Logger | undefined

  return {
    permissions: {
      ...permissions,
      all: [
        permissions.init,
        permissions.createUsers,
        permissions.readUsers,
        permissions.impersonateUsers,
      ],
    },

    async init(userManager, logger) {
      _userManager = userManager
      _logger = logger

      const realm = await getRealmByName(userManager.data, options.name)
      if (!realm) {
        throw new Error(`Realm definition with name "${options.name}" not found`)
      }

      // update realm definition
      const loadedRealm = await realm.$jazz.ensureLoaded({ resolve: { definition: true } })

      // only update if we have permission to do so
      if (loadedRealm.definition.$jazz.owner.myRole() === "writer") {
        loadedRealm.definition.$jazz.set("displayInfo", options.displayInfo)
      }

      logger.info(`realm "%s" initialized`, options.name)
    },

    async createUser(name) {
      if (!_userManager || !_logger) {
        throw new Error("RealmContext not initialized. Call init() first.")
      }

      const { user } = await _userManager.createUser({
        realmName: options.name,
        accountName: name ?? "",
      })

      _logger.info(`user "%s" created in realm "%s"`, user.id, options.name)

      return user
    },

    async impersonate(
      ...args:
        | [AnyAccountSchema, User, ImpersonationHandler<InstanceOfSchema<AnyAccountSchema>>]
        | [User, ImpersonationHandler<Account>]
    ) {
      let accountSchema: AnyAccountSchema
      let user: User
      let handler: ImpersonationHandler<Account>

      if (args.length === 2) {
        accountSchema = co.account()
        user = args[0]
        handler = args[1]
      } else {
        accountSchema = args[0]
        user = args[1]
        handler = args[2]
      }

      if (!_userManager || !_logger) {
        throw new Error("RealmContext not initialized. Call init() first.")
      }

      const config = loadConfig(CommonReplicaConfig)
      const localNode = _userManager.data.$jazz.localNode

      const loadedUser = await user.$jazz.ensureLoaded({
        resolve: {
          credentials: { $onError: "catch" },
        },
      })

      if (!loadedUser.isManaged) {
        throw new Error(`Cannot impersonate unmanaged user with ID "${user.id}"`)
      }

      if (!loadedUser.credentials?.$isLoaded) {
        if (loadedUser.credentials?.$jazz.loadingState === "unauthorized") {
          throw new Error(
            `Current account have no permission to impersonate users in realm "${options.name}"`,
          )
        }

        throw new Error(`Credentials for managed user with ID "${user.id}" are not accessible`)
      }

      const context = await createJazzContextFromExistingCredentials({
        AccountSchema: accountSchema,
        asActiveAccount: false,
        crypto: localNode.crypto,
        sessionProvider: randomSessionProvider,
        credentials: {
          accountID: user.account.$jazz.id,
          secret: loadedUser.credentials.agentSecret as AgentSecret,
        },
        peers: [
          createWebSocketPeer({
            id: "upstream",
            role: "server",
            websocket: new WebSocket(config.RESIDE_SYNC_SERVER_URL),
          }),
        ],
      })

      try {
        await handler(context.account)
      } finally {
        await context.account.$jazz.waitForAllCoValuesSync()
        await context.logOut()
      }
    },
  }
}
