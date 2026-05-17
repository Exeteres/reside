import { applyObject, getReplicaName, getReplicaNamespace } from "../kubernetes"
import { logger } from "../logger"

const GATEWAY_API_GROUP = "gateway.networking.k8s.io"
const GATEWAY_API_VERSION = "v1"

export interface BootstrapGatewayRouteOptions {
  /**
   * The gateway name in infra namespace to attach this route to.
   */
  gatewayName: string

  /**
   * Optional HTTPRoute name in the owner replica namespace.
   * Falls back to gatewayName when omitted.
   */
  routeName?: string

  /**
   * Path prefixes exposed by this route.
   */
  paths: string[]

  /**
   * Optional backend Service name in the owner replica namespace.
   * Falls back to current replica Service name when omitted.
   */
  backendServiceName?: string

  /**
   * Optional backend Service port in the owner replica namespace.
   * Falls back to 80 when omitted.
   */
  backendServicePort?: number
}

/**
 * Creates or updates an HTTPRoute in the owner replica namespace and attaches it to the infra gateway.
 */
export async function bootstrapGatewayRoute({
  gatewayName,
  routeName,
  paths,
  backendServiceName,
  backendServicePort,
}: BootstrapGatewayRouteOptions): Promise<void> {
  const normalizedGatewayName = gatewayName.trim()

  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(normalizedGatewayName)) {
    throw new Error("Gateway name must be a valid DNS label in lowercase")
  }

  const normalizedPaths = normalizeGatewayRoutePaths(paths)
  const replicaName = getReplicaName()
  const replicaNamespace = getReplicaNamespace()
  const normalizedRouteName = routeName?.trim() || normalizedGatewayName

  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(normalizedRouteName)) {
    throw new Error("Route name must be a valid DNS label in lowercase")
  }

  const clusterDomain = process.env.RESIDE_CLUSTER_DOMAIN?.trim()
  const hostname =
    clusterDomain && clusterDomain.length > 0
      ? `${normalizedGatewayName}.${clusterDomain}`
      : normalizedGatewayName

  const normalizedBackendServiceName = backendServiceName?.trim() || replicaName
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(normalizedBackendServiceName)) {
    throw new Error("Backend Service name must be a valid DNS label in lowercase")
  }

  const normalizedBackendServicePort = backendServicePort ?? 80
  if (!Number.isInteger(normalizedBackendServicePort) || normalizedBackendServicePort <= 0) {
    throw new Error("Backend Service port must be a positive integer")
  }

  const shouldRewriteHostname = backendServiceName === undefined && backendServicePort === undefined

  const body = {
    apiVersion: `${GATEWAY_API_GROUP}/${GATEWAY_API_VERSION}`,
    kind: "HTTPRoute",
    metadata: {
      name: normalizedRouteName,
      namespace: replicaNamespace,
    },
    spec: {
      hostnames: [hostname],
      parentRefs: [
        {
          name: normalizedGatewayName,
          namespace: "replica-infra",
        },
      ],
      rules: [
        {
          matches: normalizedPaths.map(path => ({
            path: {
              type: "PathPrefix",
              value: path,
            },
          })),
          filters: shouldRewriteHostname
            ? [
                {
                  type: "URLRewrite",
                  urlRewrite: {
                    // each knative replica service is just ExternalName to the gateway
                    // so we need to set it to internal service hostname to be matched by the knative gateway
                    hostname: `${normalizedBackendServiceName}.${replicaNamespace}.svc.cluster.local`,
                  },
                },
              ]
            : undefined,
          backendRefs: [
            {
              kind: "Service",
              name: normalizedBackendServiceName,
              namespace: replicaNamespace,
              port: normalizedBackendServicePort,
            },
          ],
        },
      ],
    },
  }

  await applyObject(body)

  logger.info(
    "bootstrapped HTTPRoute %s for gateway %s with %d path(s)",
    normalizedRouteName,
    normalizedGatewayName,
    normalizedPaths.length,
  )
}

export async function boostrapGatewayRoute(options: BootstrapGatewayRouteOptions): Promise<void> {
  await bootstrapGatewayRoute(options)
}

function normalizeGatewayRoutePaths(paths: string[]): string[] {
  const normalized = [...new Set(paths.map(path => path.trim()).filter(path => path.length > 0))]

  if (normalized.length === 0) {
    return ["/"]
  }

  const withLeadingSlash = normalized.map(path => (path.startsWith("/") ? path : `/${path}`))
  return withLeadingSlash.sort((left, right) => left.localeCompare(right))
}
