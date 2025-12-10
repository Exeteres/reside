import { defineContract, defineMethod } from "@reside/shared"
import { type Account, co, z } from "jazz-tools"
import { getOrCreateRealm, Realm } from "./realm"
import { GrantedPermissionSetList, User } from "./user"

export type UserManagerContract = typeof UserManagerContract
export type UserManagerData = co.loaded<typeof UserManagerContract.data>

export const UserManagerContract = defineContract({
  identity: "ghcr.io/exeteres/reside/contracts/user-manager.v1",

  data: co.map({
    version: z.number().optional(),

    /**
     * The list of all registered users.
     *
     * Only accounts with "user:read:all" permission can read this list.
     */
    users: co.list(User),

    /**
     * The default realm where new users are registered.
     */
    defaultRealm: Realm,

    /**
     * The list of all defined realms.
     *
     * Only accounts with "realm:read:all" permission can read this list.
     */
    realms: co.list(Realm),

    /**
     * The default permission sets assigned to all users both new and existing.
     */
    defaultPermissionSets: GrantedPermissionSetList,

    /**
     * The group for users allowed to manage user account permissions.
     */
    managePermissionsGroup: co.group(),
  }),

  displayInfo: {
    ru: {
      title: "Управление пользователями",
      description: "Позволяет управлять учетными записями реальных пользователей.",
    },
    en: {
      title: "User management",
      description: "Allows managing accounts of real users.",
    },
  },

  migration: async data => {
    const version = data.version ?? 0

    if (version < 1) {
      data.$jazz.set("users", UserManagerContract.data.shape.users.create([]))
      data.$jazz.set("realms", UserManagerContract.data.shape.realms.create([]))

      const defaultRealm = await getOrCreateRealm(data, "default", data.$jazz.loadedAs as Account)
      const loadedRealm = await defaultRealm.$jazz.ensureLoaded({ resolve: { definition: true } })

      loadedRealm.definition.$jazz.set("isOpen", true)

      loadedRealm.definition.$jazz.set("displayInfo", {
        ru: {
          title: "Реалм по умолчанию",
          description: "Реалм, в котором регистрируются новые пользователи по умолчанию.",
        },
        en: {
          title: "Default Realm",
          description: "The realm where new users are registered by default.",
        },
      })

      // make it public
      loadedRealm.$jazz.owner.makePublic("reader")

      data.$jazz.set("defaultRealm", defaultRealm)

      data.$jazz.set(
        "defaultPermissionSets",
        UserManagerContract.data.shape.defaultPermissionSets.create([]),
      )

      data.$jazz.set(
        "managePermissionsGroup",
        UserManagerContract.data.shape.managePermissionsGroup.create(),
      )
    }

    if (version !== 1) {
      data.$jazz.set("version", 1)
    }
  },

  methods: {
    register: {
      displayInfo: {
        ru: {
          title: "Регистрация пользователя",
          description:
            "Регистрирует текущего пользователя в дефолтном реалме и выдать ему дефолтные разрешения.",
        },
        en: {
          title: "User Registration",
          description:
            "Registers the current user in the default realm and granting them default permissions.",
        },
      },

      definition: (url, workerId) => {
        return defineMethod({
          url,
          workerId,

          request: {},

          response: {
            schema: { user: User },
            resolve: { user: true },
          },
        })
      },
    },

    createUser: {
      displayInfo: {
        ru: {
          title: "Создание пользователя",
          description: "Создает нового пользователя в заданном реалме.",
        },
        en: {
          title: "Create User",
          description: "Creates a new user in the specified realm.",
        },
      },

      definition: (url, workerId) => {
        return defineMethod({
          url,
          workerId,

          request: {
            schema: {
              realmName: z.string(),
              accountName: z.string(),
            },
          },

          response: {
            schema: { user: User },
            resolve: { user: true },
          },
        })
      },
    },
  },

  permissions: {
    "user:read:all": {
      params: z.object(),

      displayInfo: {
        ru: {
          title: "Чтение всех пользователей",
          description: "Разрешает читать информацию обо всех зарегистрированных пользователях.",
        },
        en: {
          title: "Read all users",
          description: "Allows reading information about all registered users.",
        },
      },

      onGranted: async (data, account) => {
        const loadedData = await data.$jazz.ensureLoaded({ resolve: { users: true } })

        loadedData.users.$jazz.owner.addMember(account, "reader")
      },

      onRevoked: async (data, account) => {
        const loadedData = await data.$jazz.ensureLoaded({ resolve: { users: true } })

        loadedData.users.$jazz.owner.removeMember(account)
      },
    },

    "user:read:realm": {
      params: z.object({ realmName: z.string() }),
      instanceKeys: ["realmName"],

      displayInfo: {
        ru: {
          title: `Чтение пользователей реалма "{realmName}"`,
          description: `Позволяет читать информацию о пользователях реалма "{realmName}".`,
        },
        en: {
          title: `Read realm "{realmName}" users`,
          description: `Allows reading information about users of realm "{realmName}".`,
        },
      },

      onGranted: async (data, account, params) => {
        const realm = await getOrCreateRealm(data, params.realmName, account)
        const loadedRealm = await realm.$jazz.ensureLoaded({ resolve: { users: true } })

        loadedRealm.users.$jazz.owner.addMember(account, "reader")
      },

      onRevoked: async (data, account, params) => {
        const realm = await getOrCreateRealm(data, params.realmName, account)
        const loadedRealm = await realm.$jazz.ensureLoaded({ resolve: { users: true } })

        loadedRealm.users.$jazz.owner.removeMember(account)
      },
    },

    "user:create:realm": {
      params: z.object({ realmName: z.string() }),
      instanceKeys: ["realmName"],

      displayInfo: {
        ru: {
          title: `Создание пользователей реалма "{realmName}"`,
          description: `Позволяет создавать новых пользователей в реалме "{realmName}".`,
        },
        en: {
          title: `Create realm "{realmName}" users`,
          description: `Allows creating new users in realm "{realmName}".`,
        },
      },
    },

    "default-permissions:read": {
      params: z.object(),

      displayInfo: {
        ru: {
          title: "Чтение разрешений по умолчанию",
          description:
            "Разрешает читать наборы разрешений, назначаемые всем пользователям по умолчанию.",
        },
        en: {
          title: "Read default permissions",
          description: "Allows reading the permission sets assigned to all users by default.",
        },
      },

      onGranted: async (data, account) => {
        const loadedData = await data.$jazz.ensureLoaded({
          resolve: { defaultPermissionSets: true },
        })

        loadedData.defaultPermissionSets.$jazz.owner.addMember(account, "reader")
      },

      onRevoked: async (data, account) => {
        const loadedData = await data.$jazz.ensureLoaded({
          resolve: { defaultPermissionSets: true },
        })

        loadedData.defaultPermissionSets.$jazz.owner.removeMember(account)
      },
    },

    "default-permissions:manage": {
      params: z.object(),

      displayInfo: {
        ru: {
          title: "Управление разрешениями по умолчанию",
          description:
            "Разрешает изменять наборы разрешений, которые назначаются всем пользователям по умолчанию.",
        },
        en: {
          title: "Manage default permissions",
          description:
            "Allows modifying the permission sets that are assigned to all users by default.",
        },
      },

      onGranted: async (data, account) => {
        const loadedData = await data.$jazz.ensureLoaded({
          resolve: { defaultPermissionSets: true },
        })

        loadedData.defaultPermissionSets.$jazz.owner.addMember(account, "writer")
      },

      onRevoked: async (data, account) => {
        const loadedData = await data.$jazz.ensureLoaded({
          resolve: { defaultPermissionSets: true },
        })

        loadedData.defaultPermissionSets.$jazz.owner.removeMember(account)
      },
    },

    "user:permission:manage:all": {
      params: z.object(),

      displayInfo: {
        ru: {
          title: "Управление разрешениями пользователей",
          description: "Позволяет изменять разрешения любых пользователей в системе.",
        },
        en: {
          title: "Manage user permissions",
          description: "Allows modifying permissions of any users in the system.",
        },
      },

      onGranted: async (data, account) => {
        const loadedData = await data.$jazz.ensureLoaded({
          resolve: { managePermissionsGroup: true },
        })

        loadedData.managePermissionsGroup.addMember(account, "writer")
      },

      onRevoked: async (data, account) => {
        const loadedData = await data.$jazz.ensureLoaded({
          resolve: { managePermissionsGroup: true },
        })

        loadedData.managePermissionsGroup.removeMember(account)
      },
    },

    "realm:read:all": {
      params: z.object(),

      displayInfo: {
        ru: {
          title: "Чтение всех реалмов",
          description: "Разрешает читать информацию обо всех определенных реалмах.",
        },
        en: {
          title: "Read all realms",
          description: "Allows reading information about all defined realms.",
        },
      },

      onGranted: async (data, account) => {
        const loadedData = await data.$jazz.ensureLoaded({ resolve: { realms: true } })

        loadedData.realms.$jazz.owner.addMember(account, "reader")
      },

      onRevoked: async (data, account) => {
        const loadedData = await data.$jazz.ensureLoaded({ resolve: { realms: true } })

        loadedData.realms.$jazz.owner.removeMember(account)
      },
    },

    "realm:read": {
      params: z.object({ name: z.string() }),
      instanceKeys: ["name"],

      displayInfo: {
        ru: {
          title: `Чтение реалма "{name}"`,
          description: `Позволяет читать информацию о реалме "{name}".`,
        },
        en: {
          title: `Read realm "{name}"`,
          description: `Allows reading information about realm "{name}".`,
        },
      },

      onGranted: async (data, account, params) => {
        const realm = await getOrCreateRealm(data, params.name, account)

        realm.$jazz.owner.addMember(account, "reader")
      },

      onRevoked: async (data, account, params) => {
        const realm = await getOrCreateRealm(data, params.name, account)

        realm.$jazz.owner.removeMember(account)
      },
    },

    "realm:manage": {
      params: z.object({ name: z.string() }),
      instanceKeys: ["name"],

      displayInfo: {
        ru: {
          title: `Управление реалмом "{name}"`,
          description: `Позволяет изменять определение реалма "{name}".`,
        },
        en: {
          title: `Manage realm "{name}"`,
          description: `Allows modifying the definition of realm "{name}".`,
        },
      },

      onGranted: async (data, account, params) => {
        const realm = await getOrCreateRealm(data, params.name, account)
        const loadedRealm = await realm.$jazz.ensureLoaded({ resolve: { definition: true } })

        loadedRealm.definition.$jazz.owner.addMember(account, "writer")
      },

      onRevoked: async (data, account, params) => {
        const realm = await getOrCreateRealm(data, params.name, account)
        const loadedRealm = await realm.$jazz.ensureLoaded({ resolve: { definition: true } })

        loadedRealm.definition.$jazz.owner.removeMember(account)
      },
    },

    "user:impersonate:realm": {
      params: z.object({ realmName: z.string() }),
      instanceKeys: ["realmName"],

      displayInfo: {
        ru: {
          title: `Имперсонация пользователей реалма "{realmName}"`,
          description: `Позволяет выполнять действия от имени любых пользователей реалма "{realName}", управляемых Пользовательской Репликой.`,
        },
        en: {
          title: `Impersonate realm "{realmName}" users`,
          description: `Allows performing actions on behalf of any users of realm "{realmName}" managed by the User Replica.`,
        },
      },

      onGranted: async (data, account, params) => {
        const realm = await getOrCreateRealm(data, params.realmName, account)
        const loadedRealm = await realm.$jazz.ensureLoaded({
          resolve: { impersonateUsersGroup: true },
        })

        loadedRealm.impersonateUsersGroup.addMember(account, "reader")
      },

      onRevoked: async (data, account, params) => {
        const realm = await getOrCreateRealm(data, params.realmName, account)
        const loadedRealm = await realm.$jazz.ensureLoaded({
          resolve: { impersonateUsersGroup: true },
        })

        loadedRealm.impersonateUsersGroup.removeMember(account)
      },
    },
  },
})
