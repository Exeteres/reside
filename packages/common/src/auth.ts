import { status } from "@grpc/grpc-js"
import { type CallOptions, ServerError } from "nice-grpc"
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
export async function authenticate(callOptions: CallOptions): Promise<AuthenticationResult> {
  try {
    const token = getBearerTokenFromMetadata(callOptions)

    return await authenticateToken(token)
  } catch (error) {
    if (error instanceof ServerError) {
      throw error
    }

    logger.warn({ error }, "invalid authentication token")

    throw new ServerError(status.UNAUTHENTICATED, "Invalid authentication token")
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
  callOptions: CallOptions,
): Promise<ReplicaAuthenticationResult> {
  const subject = await authenticate(callOptions)

  if (subject.realm !== "replica") {
    throw new ServerError(
      status.UNAUTHENTICATED,
      `Invalid token realm: expected "replica", got "${subject.realm}"`,
    )
  }

  return {
    ...subject,
    namespace: `replica-${subject.name}`,
  } as ReplicaAuthenticationResult
}

function getBearerTokenFromMetadata(callOptions: CallOptions): string {
  const authorization =
    callOptions.metadata?.get("authorization") ?? callOptions.metadata?.get("Authorization")

  if (typeof authorization !== "string") {
    throw new ServerError(
      status.UNAUTHENTICATED,
      'Missing "authorization" metadata for authentication',
    )
  }

  return getBearerToken(authorization)
}

function getBearerToken(authorization: string): string {
  const [scheme, token] = authorization.split(" ")
  if (scheme !== "Bearer" || !token) {
    throw new ServerError(
      status.UNAUTHENTICATED,
      'Invalid "authorization" metadata format, expected "Bearer <token>"',
    )
  }

  return token
}
