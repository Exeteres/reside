import { KubernetesSentinelContract } from "@contracts/kubernetes-sentinel.v1"
import { defineReplica } from "@reside/shared"

export const KubernetesSentinel = defineReplica({
  identity: "ghcr.io/exeteres/reside/replicas/kubernetes-sentinel",

  info: {
    name: "kubernetes-sentinel",
    class: "long-running",
    exclusive: true,
    scalable: true,
  },

  implementations: {
    k8s: KubernetesSentinelContract,
  },

  displayInfo: {
    en: {
      title: "Kubernetes Sentinel",
      description: "Monopolizes management of Kubernetes resources.",
    },
    ru: {
      title: "Кубовая Реплика",
      description: "Монополизирует управления Kubernetes-ресурсами.",
    },
  },
})
