import { defineReplica, type Replica } from "./shared"
import { sortReplicasByDependencies } from "./sort"

export const databaseReplica = defineReplica({
  name: "database",
  optionalDependencies: {
    replicas: {
      alpha: (): Replica => alphaReplica,
      access: (): Replica => accessReplica,
      interaction: (): Replica => telegramReplica,
    },
  },
})

export const accessReplica = defineReplica({
  name: "access",
  dependencies: {
    replicas: {
      database: databaseReplica,
    },
  },
  optionalDependencies: {
    replicas: {
      alpha: (): Replica => alphaReplica,
      interaction: (): Replica => telegramReplica,
    },
  },
})

export const telegramReplica = defineReplica({
  name: "telegram",
  dependencies: {
    replicas: {
      access: accessReplica,
      database: databaseReplica,
    },
  },
  optionalDependencies: {
    replicas: {
      alpha: (): Replica => alphaReplica,
    },
  },
  secrets: {
    telegram: {
      bot_token: "$TELEGRAM_BOT_TOKEN",
    },
  },
  configMaps: {
    telegram: {
      system_chat_id: "$TELEGRAM_SYSTEM_CHAT_ID",
      super_admin_user_id: "$TELEGRAM_SUPER_ADMIN_USER_ID",
    },
  },
})

export const alphaReplica = defineReplica({
  name: "alpha",
  dependencies: {
    replicas: {
      access: accessReplica,
      database: databaseReplica,
      interaction: telegramReplica,
    },
  },

  // allow alpha replica to manage reside-operator
  clusterRoleRules: [
    {
      apiGroups: ["reside.io"],
      resources: ["replicas"],
      verbs: ["get", "list", "watch", "create", "update", "patch", "delete"],
    },
  ],
})

export const rateReplica = defineReplica({
  name: "rate",
  dependencies: {
    replicas: {
      access: accessReplica,
      database: databaseReplica,
      interaction: telegramReplica,
    },
  },
})

export const engineerReplica = defineReplica({
  name: "engineer",
  dependencies: {
    replicas: {
      alpha: alphaReplica,
      access: accessReplica,
      database: databaseReplica,
      interaction: telegramReplica,
    },
  },
  secrets: {
    "github-app": {
      app_id: "$ENGINEER_GITHUB_APP_ID",
      client_id: "$ENGINEER_GITHUB_APP_CLIENT_ID",
      client_secret: "$ENGINEER_GITHUB_APP_CLIENT_SECRET",
      private_key: "$file:ENGINEER_GITHUB_APP_PRIVATE_KEY",
      installation_id: "$ENGINEER_GITHUB_APP_INSTALLATION_ID",
    },
    copilot: {
      user_token: "$ENGINEER_COPILOT_USER_TOKEN",
    },
  },
  configMaps: {
    "github-repository": {
      owner: "$ENGINEER_GITHUB_REPOSITORY_OWNER",
      name: "$ENGINEER_GITHUB_REPOSITORY_NAME",
    },
  },
})

export const topology = sortReplicasByDependencies([
  accessReplica,
  databaseReplica,
  telegramReplica,
  rateReplica,
  engineerReplica,
  alphaReplica,
])
