import { assert, defineContract, defineMethod } from "@reside/shared"
import { co, Group, z } from "jazz-tools"
import { ContractEntity } from "./contract-entity"
import { CreateLoadRequestInput, ReplicaLoadRequest } from "./load-request"
import { Replica, ReplicaVersion } from "./replica"

export type AlphaData = co.loaded<typeof AlphaContract.data>
export type AlphaContract = typeof AlphaContract

export const AlphaContract = defineContract({
  identity: "ghcr.io/exeteres/reside/contracts/alpha.v1",

  displayInfo: {
    ru: {
      title: "Альфа Реплика",
      description: "Позволяет управлять другими репликами и их загрузкой в кластер.",
    },
    en: {
      title: "Alpha Replica",
      description: "Allows managing other replicas and their loading into the cluster.",
    },
  },

  data: co.map({
    version: z.number().optional(),

    /**
     * The super admin account granted all permissions on initial cluster setup.
     *
     * Will be empty until the first super admin claims access.
     */
    superAdminAccount: co.account().optional(),

    /**
     * The list of all replicas registered in the cluster.
     *
     * Only readable by accounts with `replica:read:all` permission.
     *
     * To access replicas by ID or identity, use the `getReplicaById` and `getReplicasByIdentity` methods.
     */
    replicas: co.list(Replica),

    /**
     * The list of all contracts registered in the cluster.
     *
     * Only readable by accounts with `contract:read:all` permission.
     *
     * To access managed contracts by ID or identity, use the `getManagedContractById` method.
     */
    contracts: co.list(ContractEntity),

    /**
     * The list of all load requests registered in the cluster.
     *
     * Only readable by accounts with `load-request:read:all` permission.
     */
    loadRequests: co.list(ReplicaLoadRequest),

    /**
     * The group that can manage all RCBs in the cluster.
     *
     * Only accounts with `rcb:manage:all` permission can be added to this group.
     */
    rcbManageGroup: co.group(),

    /**
     * The group that can manage all replicas in the cluster.
     *
     * Only accounts with `replica:manage:all` permission can be added to this group.
     */
    replicaManageGroup: co.group(),
  }),

  migration: async data => {
    const version = data.version ?? 0

    if (version < 1) {
      data.$jazz.set("replicas", AlphaContract.data.shape.replicas.create([], Group.create()))
      data.$jazz.set("contracts", AlphaContract.data.shape.contracts.create([], Group.create()))

      data.$jazz.set(
        "loadRequests",
        AlphaContract.data.shape.loadRequests.create([], Group.create()),
      )

      data.$jazz.set("rcbManageGroup", Group.create())
      data.$jazz.set("replicaManageGroup", Group.create())

      assert(data.replicas.$isLoaded)
      assert(data.contracts.$isLoaded)
      assert(data.loadRequests.$isLoaded)
      assert(data.rcbManageGroup.$isLoaded)
      assert(data.replicaManageGroup.$isLoaded)
    }

    if (version !== 1) {
      data.$jazz.set("version", 1)
    }
  },

  methods: {
    createLoadRequest: {
      displayInfo: {
        ru: {
          title: "Создание запроса на загрузку реплики",
          description: "Метод для создания запроса на загрузку новой реплики в кластер.",
        },
        en: {
          title: "Create Load Request",
          description: "Method to create a load request for a new replica in the cluster.",
        },
      },

      definition: (url, workerId) => {
        return defineMethod({
          url,
          workerId,

          request: {
            input: CreateLoadRequestInput,
          },

          response: {
            schema: {
              loadRequest: ReplicaLoadRequest,
            },
            resolve: { loadRequest: true },
          },
        })
      },
    },

    approveLoadRequest: {
      displayInfo: {
        ru: {
          title: "Подтверждение запроса на загрузку реплики",
          description: "Метод для подтверждения запроса на загрузку новой реплики в кластер.",
        },
        en: {
          title: "Approve Load Request",
          description: "Method to approve a load request for a new replica in the cluster.",
        },
      },

      definition: (url, workerId) => {
        return defineMethod({
          url,
          workerId,

          request: {
            /**
             * The ID of the load request to approve.
             */
            loadRequestId: z.number(),

            /**
             * The mapping of requirement keys to arrays of replica IDs implementing those requirements.
             *
             * Only the replicas from `alternatives` list in the `ReplicaPreResolvedRequirement` can be used here.
             */
            requirementReplicaIds: z.record(z.string(), z.array(z.number())),
          },

          response: {
            schema: {
              loadRequest: ReplicaLoadRequest,

              /**
               * The created replica version for the approved load request.
               */
              replicaVersion: ReplicaVersion,
            },
            resolve: {
              loadRequest: true,
              replicaVersion: {
                replica: true,
              },
            },
          },
        })
      },
    },

    rejectLoadRequest: {
      displayInfo: {
        ru: {
          title: "Отклонение запроса на загрузку реплики",
          description: "Метод для отклонения запроса на загрузку новой реплики в кластер.",
        },
        en: {
          title: "Reject Load Request",
          description: "Method to reject a load request for a new replica in the cluster.",
        },
      },

      definition: (url, workerId) => {
        return defineMethod({
          url,
          workerId,

          request: {
            /**
             * The ID of the load request to reject.
             */
            loadRequestId: z.number(),

            /**
             * The optional reason for rejecting the load request.
             */
            reason: z.string().optional(),
          },

          response: {
            loadRequest: ReplicaLoadRequest,
          },
        })
      },
    },

    claimSuperAdminAccess: {
      displayInfo: {
        ru: {
          title: "Запрос доступа супер администратора",
          description:
            "Метод для запроса доступа супер администратора после первого запуска кластера.",
        },
        en: {
          title: "Claim Super Admin Access",
          description: "Method to claim super admin access after the first cluster startup.",
        },
      },

      definition: (url, workerId) => {
        return defineMethod({
          url,
          workerId,

          request: {},
          response: {},
        })
      },
    },
  },

  permissions: {
    "replica:read:all": {
      params: z.object(),

      displayInfo: {
        ru: {
          title: "Чтение информации о репликах и контрактах",
          description:
            "Позволяет читать информацию обо всех репликах и контрактах, зарегистрированных в кластере.",
        },
      },

      onGranted: async (data, account) => {
        const loaded = await data.$jazz.ensureLoaded({
          resolve: { replicas: true, contracts: true },
        })

        loaded.replicas.$jazz.owner.addMember(account, "reader")
        loaded.contracts.$jazz.owner.addMember(account, "reader")
      },

      onRevoked: async (data, account) => {
        const loaded = await data.$jazz.ensureLoaded({
          resolve: { replicas: true, contracts: true },
        })

        loaded.replicas.$jazz.owner.removeMember(account)
        loaded.contracts.$jazz.owner.removeMember(account)
      },
    },

    "load-request:create": {
      params: z.object(),

      displayInfo: {
        ru: {
          title: "Запрос на загрузку реплики",
          description: "Позволяет создавать запросы на загрузку новых реплик в кластер.",
        },
      },
    },

    "load-request:read:all": {
      params: z.object(),

      displayInfo: {
        ru: {
          title: "Чтение всех запросов на загрузку реплик",
          description: "Позволяет читать все запросы на загрузку новых реплик в кластер.",
        },
      },

      onGranted: async (data, account) => {
        const loaded = await data.$jazz.ensureLoaded({ resolve: { loadRequests: true } })

        loaded.loadRequests.$jazz.owner.addMember(account, "reader")
      },

      onRevoked: async (data, account) => {
        const loaded = await data.$jazz.ensureLoaded({ resolve: { loadRequests: true } })

        loaded.loadRequests.$jazz.owner.removeMember(account)
      },
    },

    "load-request:approve": {
      params: z.object(),

      displayInfo: {
        ru: {
          title: "Подтверждение загрузки реплики",
          description: "Позволяет подтверждать запросы на загрузку новых реплик в кластер.",
        },
      },
    },

    "rcb:manage:all": {
      params: z.object(),

      displayInfo: {
        ru: {
          title: "Управление всеми RCB",
          description:
            "Позволяет управлять блоками управления всех реплик в кластере. Иными словами, позволяет приказывать репликам наделять или отзывать любые разрешения любым аккаунтам.",
        },
        en: {
          title: "Manage all RCBs",
          description:
            "Allows managing the control blocks of all replicas in the cluster. In other words, allows instructing replicas to grant or revoke any permissions to any accounts.",
        },
      },

      onGranted: async (data, account) => {
        const loaded = await data.$jazz.ensureLoaded({ resolve: { rcbManageGroup: true } })

        loaded.rcbManageGroup.addMember(account, "writer")
      },

      onRevoked: async (data, account) => {
        const loaded = await data.$jazz.ensureLoaded({ resolve: { rcbManageGroup: true } })

        loaded.rcbManageGroup.removeMember(account)
      },
    },

    "replica:manage:all": {
      params: z.object(),

      displayInfo: {
        ru: {
          title: "Управление всеми репликами",
          description:
            "Позволяет управлять всеми репликами в кластере: включать и выключать их. Не путать с rcb:manage:all.",
        },
        en: {
          title: "Manage all replicas",
          description:
            "Allows managing all replicas in the cluster: enabling and disabling them. Not to be confused with rcb:manage:all.",
        },
      },

      onGranted: async (data, account) => {
        const loaded = await data.$jazz.ensureLoaded({ resolve: { replicaManageGroup: true } })

        loaded.replicaManageGroup.addMember(account, "writer")
      },

      onRevoked: async (data, account) => {
        const loaded = await data.$jazz.ensureLoaded({ resolve: { replicaManageGroup: true } })

        loaded.replicaManageGroup.removeMember(account)
      },
    },
  },
})
