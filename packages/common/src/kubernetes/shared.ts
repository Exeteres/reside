import { KubeConfig } from "@kubernetes/client-node"

/**
 * The global Kubernetes configuration instance, loaded once and shared across the application.
 */
export const kubeConfig = new KubeConfig()
kubeConfig.loadFromDefault()

function getRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name]
  if (value && value.length > 0) {
    return value
  }

  throw new Error(`"${name}" environment variable is required`)
}

/**
 * The name of the replica.
 */
export function getReplicaName(): string {
  return getRequiredEnvironmentVariable("REPLICA_NAME")
}

/**
 * The full name of the replica component.
 */
export function getReplicaComponentName(): string {
  return getRequiredEnvironmentVariable("REPLICA_COMPONENT_NAME")
}

/**
 * The namespace in which the current replica is running.
 */
export function getReplicaNamespace(): string {
  return getRequiredEnvironmentVariable("REPLICA_NAMESPACE")
}

/**
 * The internal cluster endpoint for the current replica, used for inter-replica communication.
 */
export function getReplicaEndpoint(): string {
  return `${getReplicaName()}.${getReplicaNamespace()}.svc.cluster.local`
}

/**
 * The name of the current replica's service account, used for authentication and token requests.
 */
export function getReplicaServiceAccountName(): string {
  return getRequiredEnvironmentVariable("REPLICA_SERVICE_ACCOUNT_NAME")
}

/**
 * The current replica's image used for all workloads, ensuring consistency across deployments and jobs.
 */
export function getReplicaImage(): string {
  return getRequiredEnvironmentVariable("REPLICA_IMAGE")
}
