import { AlphaContract } from "@contracts/alpha.v1"
import { UserManagerContract } from "@contracts/user-manager.v1"
import { defineReplica } from "@reside/shared"

export const UserManagerReplica = defineReplica({
  identity: "ghcr.io/exeteres/reside/replicas/user-manager",

  info: {
    name: "user-manager",
    class: "long-running",
    exclusive: true,
    scalable: true,
  },

  displayInfo: {
    ru: {
      title: "Пользовательская Реплика",
      description: "Управляет учетными записями реальных пользователей в системе.",
    },
    en: {
      title: "User Manager Replica",
      description: "Manages real user accounts in the system.",
    },
  },

  implementations: {
    userManager: UserManagerContract,
  },

  requirements: {
    alpha: {
      contract: AlphaContract,
      permissions: [
        //
        { name: "replica:read:all" },
        { name: "rcb:manage:all" },
      ],
    },
  },
})
