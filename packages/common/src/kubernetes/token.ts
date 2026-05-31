import { EventEmitter } from "node:events"
import { InterceptingCall, type Interceptor } from "@grpc/grpc-js"
import { CoreV1Api } from "@kubernetes/client-node"
import { logger } from "../logger"
import { getReplicaNamespace, getReplicaServiceAccountName, kubeConfig } from "./shared"

type CachedToken = {
  token: string
  expiresAt: number
}

/**
 * Normalizes a gRPC target or endpoint into an audience value used in Kubernetes TokenRequest.
 *
 * The resulting value always contains only the endpoint host without gRPC resolver prefixes,
 * URI schemes, paths, or ports.
 *
 * @param audience The raw audience value or gRPC target.
 * @returns The normalized endpoint host.
 */
export function normalizeAudienceEndpoint(audience: string): string {
  let value = audience.trim()
  if (value.length === 0) {
    throw new Error("Audience must not be empty")
  }

  if (value.includes("://")) {
    const parsedUrl = new URL(value)
    value = parsedUrl.host
  }

  if (value.startsWith("dns:///")) {
    value = value.slice("dns:///".length)
  } else if (value.startsWith("dns://")) {
    value = value.slice("dns://".length)
  } else if (value.startsWith("dns:")) {
    value = value.slice("dns:".length)
  }

  value = value.replace(/^\/+/, "")

  const pathSeparatorIndex = value.indexOf("/")
  if (pathSeparatorIndex >= 0) {
    value = value.slice(0, pathSeparatorIndex)
  }

  if (value.startsWith("[") && value.includes("]")) {
    const closingBracketIndex = value.indexOf("]")
    const host = value.slice(1, closingBracketIndex)
    if (host.length === 0) {
      throw new Error(`Invalid audience: "${audience}"`)
    }

    return host
  }

  const [host, port] = value.split(":")
  if (port !== undefined && /^\d+$/.test(port)) {
    if (!host) {
      throw new Error(`Invalid audience: "${audience}"`)
    }

    value = host
  }

  value = value.replace(/\.$/, "")

  if (value.length === 0) {
    throw new Error(`Invalid audience: "${audience}"`)
  }

  return value
}

/**
 * Mints a Kubernetes OIDC token for the current replica service account.
 * The token expires after 15 minutes.
 *
 * @param audience The intended audience for the token, typically the gRPC service endpoint.
 * @returns The minted OIDC token as a string.
 * @throws If the token request fails or the response is invalid.
 */
async function requestTokenForAudience(audience: string): Promise<string> {
  logger.info('requesting kubernetes service account token for audience "%s"', audience)

  const coreApi = kubeConfig.makeApiClient(CoreV1Api)

  const tokenRequest = await coreApi.createNamespacedServiceAccountToken({
    name: getReplicaServiceAccountName(),
    namespace: getReplicaNamespace(),
    body: {
      apiVersion: "authentication.k8s.io/v1",
      kind: "TokenRequest",
      spec: {
        audiences: [audience],
        expirationSeconds: 900, // 15 minutes
      },
    },
  })

  const token = tokenRequest.status?.token
  if (!token || token.length === 0) {
    throw new Error(
      `Failed to obtain token for audience "${audience}": Token is missing in response`,
    )
  }

  logger.info('received kubernetes service account token for audience "%s"', audience)

  return token
}

const tokenCache = new Map<string, CachedToken>()
const pendingTokenRequests = new Map<string, Promise<CachedToken>>()
const tokenEventEmitter = new EventEmitter()

/**
 * Retrieves a cached token for the specified audience or requests a new one if the cached token is missing or expired.
 *
 * @param audience The intended audience for the token, typically the gRPC service endpoint.
 * @returns A valid OIDC token as a string.
 * @throws If the token request fails or the response is invalid.
 */
export async function getTokenForAudience(audience: string): Promise<string> {
  audience = normalizeAudienceEndpoint(audience)

  const cached = tokenCache.get(audience)
  const now = Date.now()

  if (cached && cached.expiresAt > now) {
    logger.trace('using cached token for audience "%s"', audience)
    return cached.token
  }

  const pendingRequest = pendingTokenRequests.get(audience)
  if (pendingRequest) {
    logger.debug('waiting for in-flight token request for audience "%s"', audience)
    const pendingToken = await pendingRequest

    return pendingToken.token
  }

  const tokenRequest = (async (): Promise<CachedToken> => {
    try {
      const token = await requestTokenForAudience(audience)
      const cacheEntry = {
        token,
        // cache the token with an expiration time 1 minute before the actual expiration to account for clock skew
        expiresAt: Date.now() + 14 * 60 * 1000,
      }

      tokenCache.set(audience, cacheEntry)
      logger.debug('cached token for audience "%s"', audience)
      tokenEventEmitter.emit(`tokenRefreshed:${audience}`, token)

      return cacheEntry
    } catch (error) {
      logger.error({ error }, 'failed to request token for audience "%s"', audience)
      throw error
    }
  })()

  pendingTokenRequests.set(audience, tokenRequest)

  try {
    const requestedToken = await tokenRequest

    return requestedToken.token
  } finally {
    pendingTokenRequests.delete(audience)
  }
}

/**
 * Subscribes to token refresh events for the specified audience.
 * The callback will be invoked with the new token whenever it is refreshed.
 *
 * @param audience The intended audience for the token, typically the gRPC service endpoint.
 * @param callback A function to be called with the new token whenever it is refreshed.
 * @returns A function that can be called to unsubscribe from token refresh events.
 */
export function subscribeToTokenRefresh(
  audience: string,
  callback: (token: string) => void,
): () => void {
  audience = normalizeAudienceEndpoint(audience)

  const listener = async () => {
    try {
      const token = await getTokenForAudience(audience)
      callback(token)
    } catch (error) {
      logger.error({ error }, 'failed to refresh token for audience "%s"', audience)
    }
  }

  tokenEventEmitter.on(`tokenRefreshed:${audience}`, listener)

  return () => {
    tokenEventEmitter.off(`tokenRefreshed:${audience}`, listener)
  }
}

/**
 * Creates a gRPC interceptor that adds an "authorization" header with a bearer token for the specified audience.
 *
 * @param audience The intended audience for the token, typically the gRPC service endpoint.
 * @returns A gRPC interceptor function.
 */
export function createAuthInterceptor(audience: string): Interceptor {
  audience = normalizeAudienceEndpoint(audience)

  return (options, nextCall) => {
    return new InterceptingCall(nextCall(options), {
      start: async (metadata, listener, next) => {
        const token = await getTokenForAudience(audience)

        metadata.add("authorization", `Bearer ${token}`)
        next(metadata, listener)
      },
    })
  }
}
