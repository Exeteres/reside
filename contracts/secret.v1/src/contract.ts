import { defineContract } from "@reside/shared"
import { co, z } from "jazz-tools"
import { getOrCreateManagedSecret, ManagedSecret } from "./secret"

export type SecretConract = typeof SecretContract
export type SecretData = co.loaded<typeof SecretContract.data>

const permissionParams = z.object({
  /**
   * The name of the secret to read value for.
   */
  name: z.string().meta({
    displayInfo: {
      ru: {
        title: "Имя секрета",
      },
      en: {
        title: "Secret Name",
      },
    },
  }),
})

export const SecretContract = defineContract({
  identity: "ghcr.io/exeteres/reside/contracts/secret.v1",

  data: co.map({
    version: z.number().optional(),

    /**
     * The list of all definitions of secrets in the system.
     *
     * Only users with "definition:read:all" permission can read this list.
     */
    secrets: co.list(ManagedSecret),

    /**
     * The group for users allowed to read/write all secret values.
     */
    allValueGroup: co.group(),
  }),

  displayInfo: {
    ru: {
      title: "Управление секретами",
      description: "Безопасное управление секретами и конфигурацией.",
    },
    en: {
      title: "Secret Management",
      description: "Secure management of secrets and configuration.",
    },
  },

  migration: data => {
    const version = data.version ?? 0

    if (version < 1) {
      data.$jazz.set("secrets", SecretContract.data.shape.secrets.create([]))
      data.$jazz.set("allValueGroup", SecretContract.data.shape.allValueGroup.create())
    }

    if (version !== 1) {
      data.$jazz.set("version", 1)
    }
  },

  permissions: {
    "definition:manage": {
      params: permissionParams,
      getInstanceId: params => params.name,

      displayInfo: {
        ru: {
          title: `Управление определением секрета "{name}"`,
          description: `Позволяет изменять определение секрета "{name}".`,
        },
        en: {
          title: `Manage secret definition "{name}"`,
          description: `Allows modifying the definition of secret "{name}".`,
        },
      },

      async onGranted(data, account, params) {
        const secret = await getOrCreateManagedSecret(data, params.name, account)
        const loadedSecret = await secret.$jazz.ensureLoaded({ resolve: { definition: true } })

        loadedSecret.definition.$jazz.owner.addMember(account, "writer")
      },

      async onRevoked(data, account, params) {
        const secret = await getOrCreateManagedSecret(data, params.name, account)
        const loadedSecret = await secret.$jazz.ensureLoaded({ resolve: { definition: true } })

        loadedSecret.definition.$jazz.owner.removeMember(account)
      },
    },

    "definition:read:all": {
      params: z.object(),

      displayInfo: {
        ru: {
          title: "Просмотр всех определений секретов",
          description: "Позволяет просматривать все определения секретов в системе.",
        },
        en: {
          title: "Read all secret definitions",
          description: "Allows reading the list of all secret definitions in the system.",
        },
      },

      async onGranted(data, account) {
        const loadedData = await data.$jazz.ensureLoaded({ resolve: { secrets: true } })

        loadedData.secrets.$jazz.owner.addMember(account, "reader")
      },

      async onRevoked(data, account) {
        const loadedData = await data.$jazz.ensureLoaded({ resolve: { secrets: true } })

        loadedData.secrets.$jazz.owner.removeMember(account)
      },
    },

    "value:read": {
      params: permissionParams,
      getInstanceId: params => params.name,

      displayInfo: {
        ru: {
          title: `Чтение значения секрета "{name}"`,
          description: `Позволяет читать значение секрета "{name}".`,
        },
        en: {
          title: `Read secret value "{name}"`,
          description: `Allows reading the value of secret "{name}".`,
        },
      },

      async onGranted(data, account, params) {
        const secret = await getOrCreateManagedSecret(data, params.name, account)
        const loadedSecret = await secret.$jazz.ensureLoaded({ resolve: { value: true } })

        loadedSecret.value.$jazz.owner.addMember(account, "reader")
      },

      async onRevoked(data, account, params) {
        const secret = await getOrCreateManagedSecret(data, params.name, account)
        const loadedSecret = await secret.$jazz.ensureLoaded({ resolve: { value: true } })

        loadedSecret.value.$jazz.owner.removeMember(account)
      },
    },

    "value:read:all": {
      params: z.object(),

      displayInfo: {
        ru: {
          title: "Чтение всех значений секретов",
          description: "Позволяет читать значения всех секретов в системе.",
        },
        en: {
          title: "Read all secret values",
          description: "Allows reading the values of all secrets in the system.",
        },
      },

      async onGranted(data, account) {
        const loadedData = await data.$jazz.ensureLoaded({ resolve: { allValueGroup: true } })

        loadedData.allValueGroup.addMember(account, "reader")
      },

      async onRevoked(data, account) {
        const loadedData = await data.$jazz.ensureLoaded({ resolve: { allValueGroup: true } })

        loadedData.allValueGroup.removeMember(account)
      },
    },

    "value:read-write": {
      params: permissionParams,
      getInstanceId: params => params.name,

      displayInfo: {
        ru: {
          title: `Чтение и запись значения секрета "{name}"`,
          description: `Позволяет читать и изменять значение секрета "{name}".`,
        },
        en: {
          title: `Read and write secret value "{name}"`,
          description: `Allows reading and modifying the value of secret "{name}".`,
        },
      },

      async onGranted(data, account, params) {
        const secret = await getOrCreateManagedSecret(data, params.name, account)
        const loadedSecret = await secret.$jazz.ensureLoaded({ resolve: { value: true } })

        loadedSecret.value.$jazz.owner.addMember(account, "writer")
      },

      async onRevoked(data, account, params) {
        const secret = await getOrCreateManagedSecret(data, params.name, account)
        const loadedSecret = await secret.$jazz.ensureLoaded({ resolve: { value: true } })

        loadedSecret.value.$jazz.owner.removeMember(account)
      },
    },

    "value:read-write:all": {
      params: z.object(),

      displayInfo: {
        ru: {
          title: "Чтение и запись всех значений секретов",
          description: "Позволяет читать и изменять значения всех секретов в системе.",
        },
        en: {
          title: "Read and write all secret values",
          description: "Allows reading and modifying the values of all secrets in the system.",
        },
      },

      async onGranted(data, account) {
        const loadedData = await data.$jazz.ensureLoaded({ resolve: { allValueGroup: true } })

        loadedData.allValueGroup.addMember(account, "writer")
      },

      async onRevoked(data, account) {
        const loadedData = await data.$jazz.ensureLoaded({ resolve: { allValueGroup: true } })

        loadedData.allValueGroup.removeMember(account)
      },
    },
  },
})
