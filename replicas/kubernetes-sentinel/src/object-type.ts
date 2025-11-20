export type ObjectType = {
  apiVersion: string
  kind: string
  plural: string
}

export const objectTypes = {
  deployment: {
    apiVersion: "apps/v1",
    kind: "Deployment",
    plural: "deployments",
  },
  statefulSet: {
    apiVersion: "apps/v1",
    kind: "StatefulSet",
    plural: "statefulsets",
  },
  job: {
    apiVersion: "batch/v1",
    kind: "Job",
    plural: "jobs",
  },
  secret: {
    apiVersion: "v1",
    kind: "Secret",
    plural: "secrets",
  },
  configMap: {
    apiVersion: "v1",
    kind: "ConfigMap",
    plural: "configmaps",
  },
  service: {
    apiVersion: "v1",
    kind: "Service",
    plural: "services",
  },
  ingress: {
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    plural: "ingresses",
  },
  networkPolicy: {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    plural: "networkpolicies",
  },
  persistentVolumeClaim: {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    plural: "persistentvolumeclaims",
  },
  serviceAccount: {
    apiVersion: "v1",
    kind: "ServiceAccount",
    plural: "serviceaccounts",
  },
  role: {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "Role",
    plural: "roles",
  },
  roleBinding: {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "RoleBinding",
    plural: "rolebindings",
  },
} as const
