import { defineReplica, type Replica } from "./shared"
import { sortReplicasByDependencies } from "./sort"

export const infraReplica = defineReplica({
  name: "infra",
  secrets: {
    "postgres-credentials": {
      endpoint: "$INFRA_POSTGRES_ENDPOINT",
      username: "$INFRA_POSTGRES_USERNAME",
      password: "$INFRA_POSTGRES_PASSWORD",
    },
    "minio-credentials": {
      endpoint: "$INFRA_MINIO_ENDPOINT",
      username: "$INFRA_MINIO_USERNAME",
      password: "$INFRA_MINIO_PASSWORD",
    },
  },
  optionalDependencies: {
    replicas: {
      alpha: (): Replica => alphaReplica,
      access: (): Replica => accessReplica,
      interaction: (): Replica => telegramReplica,
    },
  },
  configMaps: {
    infa: {
      gateway_class_name: "$INFRA_GATEWAY_CLASS_NAME",
      gateway_http_port: "$INFRA_GATEWAY_HTTP_PORT",
      gateway_https_port: "$INFRA_GATEWAY_HTTPS_PORT",
      cluster_issuer_name: "$INFRA_CLUSTER_ISSUER_NAME",
      cluster_domain: "$INFRA_CLUSTER_DOMAIN",
    },
    vault: {
      endpoint: "$INFRA_VAULT_ENDPOINT",
      audience: "$INFRA_VAULT_AUDIENCE",
    },
  },

  bootstrapClusterRoleRules: [
    // allow managing crds for clickhouse operator
    {
      apiGroups: ["apiextensions.k8s.io"],
      resources: ["customresourcedefinitions"],
      verbs: ["get", "list", "watch", "create"],
    },
    {
      apiGroups: ["apiextensions.k8s.io"],
      resources: ["customresourcedefinitions"],
      resourceNames: [
        "clickhouseinstallations.clickhouse.altinity.com",
        "clickhouseinstallationtemplates.clickhouse.altinity.com",
        "clickhouseoperatorconfigurations.clickhouse.altinity.com",
      ],
      verbs: ["get", "update", "patch", "delete"],
    },
    // allow managing cluster-level RBAC required by monitoring charts
    {
      apiGroups: ["rbac.authorization.k8s.io"],
      resources: ["clusterroles", "clusterrolebindings"],
      verbs: ["get", "list", "watch", "create", "update", "patch", "delete", "bind", "escalate"],
    },
  ],
})

export const accessReplica = defineReplica({
  name: "access",
  dependencies: {
    replicas: {
      infra: infraReplica,
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
      infra: infraReplica,
    },
  },
  optionalDependencies: {
    replicas: {
      alpha: (): Replica => alphaReplica,
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
      infra: infraReplica,
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
    {
      apiGroups: ["policies.kyverno.io"],
      resources: ["mutatingpolicies", "deletingpolicies"],
      verbs: ["get", "list", "watch", "create", "update", "patch", "delete"],
    },
    {
      apiGroups: [""],
      resources: ["nodes"],
      verbs: ["get", "list", "watch"],
    },
  ],
})

export const engineerReplica = defineReplica({
  name: "engineer",
  dependencies: {
    replicas: {
      alpha: alphaReplica,
      access: accessReplica,
      infra: infraReplica,
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
      user_token: "$COPILOT_USER_TOKEN",
    },
  },
  configMaps: {
    "github-repository": {
      owner: "$ENGINEER_GITHUB_REPOSITORY_OWNER",
      name: "$ENGINEER_GITHUB_REPOSITORY_NAME",
    },
  },
})

export const securityReplica = defineReplica({
  name: "security",
  dependencies: {
    replicas: {
      access: accessReplica,
      infra: infraReplica,
    },
  },
  optionalDependencies: {
    replicas: {
      interaction: (): Replica => telegramReplica,
    },
  },
})

export const rateReplica = defineReplica({
  name: "rate",
  dependencies: {
    replicas: {
      infra: infraReplica,
      access: accessReplica,
      interaction: telegramReplica,
    },
  },
})

export const exampleReplica = defineReplica({
  name: "example",
  dependencies: {
    replicas: {
      infra: infraReplica,
      access: accessReplica,
      interaction: telegramReplica,
    },
  },
})

export const bankReplica = defineReplica({
  name: "bank",
  dependencies: {
    replicas: {
      infra: infraReplica,
      access: accessReplica,
      interaction: telegramReplica,
    },
  },
})

export const topology = sortReplicasByDependencies([
  accessReplica,
  infraReplica,
  telegramReplica,
  engineerReplica,
  securityReplica,
  alphaReplica,
  rateReplica,
  bankReplica,
])
