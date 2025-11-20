import { AlphaContract } from "@contracts/alpha.v1"
import { KubernetesSentinelContract } from "@contracts/kubernetes-sentinel.v1"
import { defineReplica } from "@reside/shared"

export const AlphaReplica = defineReplica({
  identity: "ghcr.io/exeteres/reside/replicas/alpha",

  info: {
    name: "alpha",
    class: "long-running",
    exclusive: true,
    scalable: true,
  },

  implementations: {
    alpha: AlphaContract,
  },

  requirements: {
    k8s: {
      contract: KubernetesSentinelContract,
      permissions: [
        { name: "deployment:manage:all" },
        { name: "job:manage:all" },
        { name: "secret:manage:all" },
        { name: "service:manage:all" },
        { name: "ingress:manage:all" },
      ],
    },
  },

  displayInfo: {
    ru: {
      title: "Альфа-Реплика",
      description: "Управляет другими репликами и запускает новые.",
    },
    en: {
      title: "Alpha Replica",
      description: "Manages other replicas and launches new ones.",
    },
  },
})
