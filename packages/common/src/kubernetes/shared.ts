import { KubeConfig, type ApiConstructor, type ApiType } from "@kubernetes/client-node"
import { SpanStatusCode, trace } from "@opentelemetry/api"

const kubernetesTracer = trace.getTracer("reside.kubernetes")

/**
 * The global Kubernetes configuration instance, loaded once and shared across the application.
 */
export const kubeConfig = new KubeConfig()
kubeConfig.loadFromDefault()
instrumentKubeConfigApiClients(kubeConfig)

function instrumentKubeConfigApiClients(config: KubeConfig): void {
  const originalMakeApiClient = config.makeApiClient.bind(config)

  config.makeApiClient = <T extends ApiType>(apiClientType: ApiConstructor<T>): T => {
    const apiClient = originalMakeApiClient(apiClientType)
    const apiName = apiClientType.name.length > 0 ? apiClientType.name : "unknown"

    return createTracedApiClient(apiClient, apiName)
  }
}

function createTracedApiClient<T extends object>(apiClient: T, apiName: string): T {
  return new Proxy(apiClient, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)

      if (typeof value !== "function") {
        return value
      }

      return (...args: unknown[]) => {
        return kubernetesTracer.startActiveSpan(`k8s.${apiName}.${String(property)}`, span => {
          span.setAttribute("rpc.system", "kubernetes")
          span.setAttribute("rpc.service", apiName)
          span.setAttribute("rpc.method", String(property))

          try {
            const result = Reflect.apply(value, target, args)

            if (isPromiseLike(result)) {
              return Promise.resolve(result)
                .then(value => {
                  span.end()
                  return value
                })
                .catch((error: unknown) => {
                  span.recordException(error as Error)
                  span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: error instanceof Error ? error.message : String(error),
                  })
                  span.end()
                  throw error
                })
            }

            span.end()
            return result
          } catch (error) {
            span.recordException(error as Error)
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error instanceof Error ? error.message : String(error),
            })
            span.end()

            throw error
          }
        })
      }
    },
  })
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (typeof value !== "object" || value === null) {
    return false
  }

  return "then" in value && typeof Reflect.get(value, "then") === "function"
}

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
 * The full endpoint of the replica in the cluster which can be used for callback hooks.
 */
export function getReplicaCallbackEndpoint(): string {
  return `${getReplicaEndpoint()}:80`
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
