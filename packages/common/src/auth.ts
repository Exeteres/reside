import { type CallOptions, Code, ConnectError, type HandlerContext } from "@connectrpc/connect"
import { authenticateToken, type AuthenticationResult } from "./jwks"
import { logger } from "./logger"

export type ReplicaAuthenticationResult = AuthenticationResult<"replica"> & {
  /**
   * The namespace which the replica belongs to, extracted from the subject name.
   */
  namespace: string
}

/**
 * Authenticates a subject using gRPC call options containing the OIDC token in the "authorization" metadata.
 *
 * @param callOptions The gRPC call options with metadata.
 * @return The authentication result containing the subject identifier, realm, and name.
 */
export async function authenticate(
  callOptions: CallOptions | HandlerContext,
): Promise<AuthenticationResult> {
  try {
    const token = getBearerTokenFromMetadata(callOptions)

    return await authenticateToken(token)
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error
    }

    logger.warn({ error }, "invalid authentication token")

    throw new ConnectError("Invalid authentication token", Code.Unauthenticated)
  }
}

/**
 * Authenticates replica using gRPC call options containing the OIDC token in the "authorization" metadata.
 * If subject is authenticated, but does not belong to "replica" realm, an error is thrown.
 *
 * @param callOptions The gRPC call options with metadata.
 * @returns The authentication result containing the subject identifier, realm, name, and namespace.
 */
export async function authenticateReplica(
  callOptions: HandlerContext,
): Promise<ReplicaAuthenticationResult> {
  const subject = await authenticate(callOptions)

  if (subject.realm !== "replica") {
    throw new ConnectError(
      `Invalid token realm: expected "replica", got "${subject.realm}"`,
      Code.Unauthenticated,
    )
  }

  return {
    ...subject,
    namespace: `replica-${subject.name}`,
  } as ReplicaAuthenticationResult
}

function getBearerTokenFromMetadata(callOptions: CallOptions | HandlerContext): string {
  const metadata = "metadata" in callOptions ? callOptions.metadata : undefined
  const requestHeader = "requestHeader" in callOptions ? callOptions.requestHeader : undefined

  const metadataAuthorization = getHeaderValue(metadata, "authorization")
  const requestAuthorization = getHeaderValue(requestHeader, "authorization")

  const authorization = metadataAuthorization ?? requestAuthorization

  if (typeof authorization !== "string") {
    throw new ConnectError(
      'Missing "authorization" metadata for authentication',
      Code.Unauthenticated,
    )
  }

  return getBearerToken(authorization)
}

function getHeaderValue(container: unknown, name: string): string | undefined {
  if (
    !container ||
    typeof container !== "object" ||
    !("get" in container) ||
    typeof container.get !== "function"
  ) {
    return undefined
  }

  const lowercaseValue = container.get(name)
  if (typeof lowercaseValue === "string") {
    return lowercaseValue
  }

  const capitalizedName = `${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`
  const capitalizedValue = container.get(capitalizedName)

  return typeof capitalizedValue === "string" ? capitalizedValue : undefined
}

function getBearerToken(authorization: string): string {
  const [scheme, token] = authorization.split(" ")
  if (scheme !== "Bearer" || !token) {
    throw new ConnectError(
      'Invalid "authorization" metadata format, expected "Bearer <token>"',
      Code.Unauthenticated,
    )
  }

  return token
}
