import type { IDeployment, IStatefulSet } from "kubernetes-models/apps/v1"
import type { IJob } from "kubernetes-models/batch/v1"
import type { IIngress, INetworkPolicy } from "kubernetes-models/networking.k8s.io/v1"
import type { IRole, IRoleBinding } from "kubernetes-models/rbac.authorization.k8s.io/v1"
import type {
  IConfigMap,
  IPersistentVolumeClaim,
  ISecret,
  IService,
  IServiceAccount,
} from "kubernetes-models/v1"
import { ok } from "node:assert"
import { defineContract, type LocalizedDisplayInfo } from "@reside/shared"
import { type Account, co, z } from "jazz-tools"
import { KubernetesManagedObject } from "./managed-object"

export type KubernetesSentinelData = co.loaded<typeof data>

type CollectionKey =
  | "deployments"
  | "secrets"
  | "configMaps"
  | "ingresses"
  | "jobs"
  | "networkPolicies"
  | "services"
  | "statefulSets"
  | "persistentVolumeClaims"
  | "serviceAccounts"
  | "roles"
  | "roleBindings"

function createReadAllPermission<TKey extends CollectionKey>(
  key: TKey,
  displayInfo: LocalizedDisplayInfo,
) {
  return {
    params: z.object(),
    displayInfo: displayInfo,

    onGranted: async (data: KubernetesSentinelData, account: Account) => {
      const loaded = await data.$jazz.ensureLoaded({ resolve: { [key]: true } })

      ok(loaded[key].$isLoaded)

      loaded[key].$jazz.owner.addMember(account, "reader")
    },

    onRevoked: async (data: KubernetesSentinelData, account: Account) => {
      const loaded = await data.$jazz.ensureLoaded({ resolve: { [key]: true } })

      ok(loaded[key].$isLoaded)

      loaded[key].$jazz.owner.removeMember(account)
    },
  }
}

function createManageAllPermission<TKey extends CollectionKey>(
  key: TKey,
  displayInfo: LocalizedDisplayInfo,
) {
  return {
    params: z.object(),
    displayInfo: displayInfo,

    onGranted: async (data: KubernetesSentinelData, account: Account) => {
      const loaded = await data.$jazz.ensureLoaded({ resolve: { [key]: true } })

      ok(loaded[key].$isLoaded)

      loaded[key].$jazz.owner.addMember(account, "writer")
    },

    onRevoked: async (data: KubernetesSentinelData, account: Account) => {
      const loaded = await data.$jazz.ensureLoaded({ resolve: { [key]: true } })

      ok(loaded[key].$isLoaded)

      loaded[key].$jazz.owner.removeMember(account)
    },
  }
}

export function createMockKubernetesSentinelData() {
  return KubernetesSentinelContract.data.create({
    deployments: {},
    secrets: {},
    configMaps: {},
    ingresses: {},
    jobs: {},
    networkPolicies: {},
    services: {},
    statefulSets: {},
    persistentVolumeClaims: {},
    serviceAccounts: {},
    roles: {},
    roleBindings: {},
  })
}

const data = co.map({
  version: z.number().optional(),

  /**
   * The reactive record of all deployments managed by the Kubernetes Sentinel.
   */
  deployments: co.record(z.string(), KubernetesManagedObject<IDeployment>()),

  /**
   * The reactive record of all stateful sets managed by the Kubernetes Sentinel.
   */
  statefulSets: co.record(z.string(), KubernetesManagedObject<IStatefulSet>()),

  /**
   * The reactive record of all jobs managed by the Kubernetes Sentinel.
   */
  jobs: co.record(z.string(), KubernetesManagedObject<IJob>()),

  /**
   * The reactive record of all secrets managed by the Kubernetes Sentinel.
   */
  secrets: co.record(z.string(), KubernetesManagedObject<ISecret>()),

  /**
   * The reactive record of all config maps managed by the Kubernetes Sentinel.
   */
  configMaps: co.record(z.string(), KubernetesManagedObject<IConfigMap>()),

  /**
   * The reactive record of all services managed by the Kubernetes Sentinel.
   */
  services: co.record(z.string(), KubernetesManagedObject<IService>()),

  /**
   * The reactive record of all ingresses managed by the Kubernetes Sentinel.
   */
  ingresses: co.record(z.string(), KubernetesManagedObject<IIngress>()),

  /**
   * The reactive record of all network policies managed by the Kubernetes Sentinel.
   */
  networkPolicies: co.record(z.string(), KubernetesManagedObject<INetworkPolicy>()),

  /**
   * The reactive record of all persistent volume claims managed by the Kubernetes Sentinel.
   */
  persistentVolumeClaims: co.record(z.string(), KubernetesManagedObject<IPersistentVolumeClaim>()),

  /**
   * The reactive record of all service accounts managed by the Kubernetes Sentinel.
   */
  serviceAccounts: co.record(z.string(), KubernetesManagedObject<IServiceAccount>()),

  /**
   * The reactive record of all roles managed by the Kubernetes Sentinel.
   */
  roles: co.record(z.string(), KubernetesManagedObject<IRole>()),

  /**
   * The reactive record of all role bindings managed by the Kubernetes Sentinel.
   */
  roleBindings: co.record(z.string(), KubernetesManagedObject<IRoleBinding>()),
})

export const KubernetesSentinelContract = defineContract({
  identity: "ghcr.io/exeteres/reside/contracts/kubernetes-sentinel.v1",
  data,

  migration: async data => {
    const version = data.version ?? 0

    if (version < 1) {
      data.$jazz.set("deployments", KubernetesSentinelContract.data.shape.deployments.create({}))

      data.$jazz.set("secrets", KubernetesSentinelContract.data.shape.secrets.create({}))

      data.$jazz.set("configMaps", KubernetesSentinelContract.data.shape.configMaps.create({}))

      data.$jazz.set("ingresses", KubernetesSentinelContract.data.shape.ingresses.create({}))

      data.$jazz.set("jobs", KubernetesSentinelContract.data.shape.jobs.create({}))

      data.$jazz.set(
        "networkPolicies",
        KubernetesSentinelContract.data.shape.networkPolicies.create({}),
      )

      data.$jazz.set("services", KubernetesSentinelContract.data.shape.services.create({}))

      data.$jazz.set("statefulSets", KubernetesSentinelContract.data.shape.statefulSets.create({}))

      data.$jazz.set(
        "persistentVolumeClaims",
        KubernetesSentinelContract.data.shape.persistentVolumeClaims.create({}),
      )

      data.$jazz.set(
        "serviceAccounts",
        KubernetesSentinelContract.data.shape.serviceAccounts.create({}),
      )

      data.$jazz.set("roles", KubernetesSentinelContract.data.shape.roles.create({}))

      data.$jazz.set("roleBindings", KubernetesSentinelContract.data.shape.roleBindings.create({}))
    }

    if (version !== 1) {
      data.$jazz.set("version", 1)
    }
  },

  displayInfo: {
    ru: {
      title: "Кубовая Реплика",
      description: "Позволяет управлять Kubernetes ресурсами в кластере.",
    },
    en: {
      title: "Kubernetes Sentinel",
      description: "Allows managing Kubernetes resources in a cluster.",
    },
  },

  permissions: {
    "deployment:read:all": createReadAllPermission("deployments", {
      ru: {
        title: "Чтение всех деплойментов",
        description: "Позволяет читать информацию обо всех управляемых деплойментах.",
      },
    }),

    "deployment:manage:all": createManageAllPermission("deployments", {
      ru: {
        title: "Управление всеми деплойментами",
        description: "Позволяет создавать, обновлять и удалять все управляемые деплойменты.",
      },
    }),

    "stateful-set:read:all": createReadAllPermission("statefulSets", {
      ru: {
        title: "Чтение всех StatefulSet'ов",
        description: "Позволяет читать информацию обо всех управляемых StatefulSet'ах.",
      },
    }),

    "stateful-set:manage:all": createManageAllPermission("statefulSets", {
      ru: {
        title: "Управление всеми StatefulSet'ами",
        description: "Позволяет создавать, обновлять и удалять все управляемые StatefulSet'ы.",
      },
    }),

    "job:read:all": createReadAllPermission("jobs", {
      ru: {
        title: "Чтение всех джобов",
        description: "Позволяет читать информацию обо всех управляемых джобах.",
      },
    }),

    "job:manage:all": createManageAllPermission("jobs", {
      ru: {
        title: "Управление всеми джобами",
        description: "Позволяет создавать, обновлять и удалять все управляемые джобы.",
      },
    }),

    "secret:read:all": createReadAllPermission("secrets", {
      ru: {
        title: "Чтение всех секретов",
        description: "Позволяет читать информацию обо всех управляемых секретах.",
      },
    }),

    "secret:manage:all": createManageAllPermission("secrets", {
      ru: {
        title: "Управление всеми секретами",
        description: "Позволяет создавать, обновлять и удалять все управляемые секреты.",
      },
    }),

    "config-map:read:all": createReadAllPermission("configMaps", {
      ru: {
        title: "Чтение всех ConfigMap'ов",
        description: "Позволяет читать информацию обо всех управляемых ConfigMap'ах.",
      },
    }),

    "config-map:manage:all": createManageAllPermission("configMaps", {
      ru: {
        title: "Управление всеми ConfigMap'ами",
        description: "Позволяет создавать, обновлять и удалять все управляемые ConfigMap'ы.",
      },
    }),

    "ingress:read:all": createReadAllPermission("ingresses", {
      ru: {
        title: "Чтение всех Ingress'ов",
        description: "Позволяет читать информацию обо всех управляемых Ingress'ах.",
      },
    }),

    "ingress:manage:all": createManageAllPermission("ingresses", {
      ru: {
        title: "Управление всеми Ingress'ами",
        description: "Позволяет создавать, обновлять и удалять все управляемые Ingress'ы.",
      },
    }),

    "network-policy:read:all": createReadAllPermission("networkPolicies", {
      ru: {
        title: "Чтение всех сетевых политик",
        description: "Позволяет читать информацию обо всех управляемых сетевых политиках.",
      },
    }),

    "network-policy:manage:all": createManageAllPermission("networkPolicies", {
      ru: {
        title: "Управление всеми сетевыми политиками",
        description: "Позволяет создавать, обновлять и удалять все управляемые сетевые политики.",
      },
    }),

    "service:read:all": createReadAllPermission("services", {
      ru: {
        title: "Чтение всех сервисов",
        description: "Позволяет читать информацию обо всех управляемых сервисах.",
      },
    }),

    "service:manage:all": createManageAllPermission("services", {
      ru: {
        title: "Управление всеми сервисами",
        description: "Позволяет создавать, обновлять и удалять все управляемые сервисы.",
      },
    }),

    "persistent-volume-claim:read:all": createReadAllPermission("persistentVolumeClaims", {
      ru: {
        title: "Чтение всех PVC",
        description: "Позволяет читать информацию обо всех управляемых PVC.",
      },
    }),

    "persistent-volume-claim:manage:all": createManageAllPermission("persistentVolumeClaims", {
      ru: {
        title: "Управление всеми PVC",
        description: "Позволяет создавать, обновлять и удалять все управляемые PVC.",
      },
    }),

    "service-account:read:all": createReadAllPermission("serviceAccounts", {
      ru: {
        title: "Чтение всех сервисных аккаунтов",
        description: "Позволяет читать информацию обо всех управляемых сервисных аккаунтах.",
      },
    }),

    "service-account:manage:all": createManageAllPermission("serviceAccounts", {
      ru: {
        title: "Управление всеми сервисными аккаунтами",
        description: "Позволяет создавать, обновлять и удалять все управляемые сервисные аккаунты.",
      },
    }),

    "role:read:all": createReadAllPermission("roles", {
      ru: {
        title: "Чтение всех ролей",
        description: "Позволяет читать информацию обо всех управляемых ролях.",
      },
    }),

    "role:manage:all": createManageAllPermission("roles", {
      ru: {
        title: "Управление всеми ролями",
        description: "Позволяет создавать, обновлять и удалять все управляемые роли.",
      },
    }),

    "role-binding:read:all": createReadAllPermission("roleBindings", {
      ru: {
        title: "Чтение всех биндингов ролей",
        description: "Позволяет читать информацию обо всех управляемых биндингах ролей.",
      },
    }),

    "role-binding:manage:all": createManageAllPermission("roleBindings", {
      ru: {
        title: "Управление всеми биндингами ролей",
        description: "Позволяет создавать, обновлять и удалять все управляемые биндинги ролей.",
      },
    }),
  },
})
