import { createRemoteJWKSet, customFetch, decodeJwt, jwtVerify } from "jose"
import { getReplicaEndpoint } from "../kubernetes"
import { logger } from "../logger"
import { kubernetesIssuerDefinitions } from "./kubernetes"
import {
  type AuthenticationResult,
  type OpenIdConfiguration,
  openIdConfigurationSchema,
  type ReplicaTokenPayload,
  type TokenVerifier,
  tokenPayloadSchema,
} from "./shared"

export const issuer = {
  ...kubernetesIssuerDefinitions,
}

const tokenVerifierPromises = new Map<string, Promise<TokenVerifier>>()

/**
 * Authenticates a subject token and returns the normalized subject identifier along with realm and name components.
 *
 * @param token The raw JWT token.
 * @returns The normalized subject identifier.
 */
export async function authenticateToken(token: string): Promise<AuthenticationResult> {
  try {
    const unverifiedPayload = decodeJwt<ReplicaTokenPayload>(token)
    const tokenPayload = tokenPayloadSchema.parse(unverifiedPayload)
    const tokenIssuer = tokenPayload.iss

    logger.info('authenticating token for issuer "%s"', tokenIssuer)

    const issuerDefinition = issuer[tokenIssuer]
    if (!issuerDefinition) {
      logger.warn('token issuer is not supported: "%s"', tokenIssuer)
      throw new Error(`Token issuer is not supported: "${tokenIssuer}"`)
    }

    const verifier = await getTokenVerifier(tokenIssuer, issuerDefinition.getRequestInit)

    const { payload } = await jwtVerify<ReplicaTokenPayload>(token, verifier.keySet, {
      issuer: verifier.issuer,
    })

    ensureExactAudience(payload.aud, getReplicaEndpoint())

    const subject = payload.sub
    if (typeof subject !== "string" || subject.length === 0) {
      throw new Error('Token is missing the "sub" claim')
    }

    const extractedSubjectId = issuerDefinition.extractSubjectName(subject)

    logger.info(
      'token authentication succeeded for realm "%s" and subject "%s"',
      issuerDefinition.realName,
      extractedSubjectId,
    )

    return {
      subjectId: `${issuerDefinition.realName}:${extractedSubjectId}`,
      realm: issuerDefinition.realName,
      name: extractedSubjectId,
    }
  } catch (error) {
    logger.error({ error }, "token authentication failed")
    throw error
  }
}

function ensureExactAudience(audienceClaim: unknown, expectedAudience: string): void {
  if (typeof audienceClaim === "string") {
    if (audienceClaim === expectedAudience) {
      return
    }

    throw new Error(
      `Token audience mismatch: expected exactly "${expectedAudience}", got "${audienceClaim}"`,
    )
  }

  if (Array.isArray(audienceClaim)) {
    if (audienceClaim.length === 1 && audienceClaim[0] === expectedAudience) {
      return
    }

    throw new Error(
      `Token audience mismatch: expected exactly ["${expectedAudience}"], got ${JSON.stringify(audienceClaim)}`,
    )
  }

  throw new Error(`Token is missing the "aud" claim, expected "${expectedAudience}"`)
}

async function getTokenVerifier(
  issuerUrl: string,
  getRequestInit?: () => Promise<RequestInit>,
): Promise<TokenVerifier> {
  const existingPromise = tokenVerifierPromises.get(issuerUrl)
  if (existingPromise) {
    logger.trace('using cached token verifier for issuer "%s"', issuerUrl)
    return await existingPromise
  }

  logger.info('creating token verifier for issuer "%s"', issuerUrl)

  const verifierPromise = loadTokenVerifier(issuerUrl, getRequestInit)
  tokenVerifierPromises.set(issuerUrl, verifierPromise)

  return await verifierPromise
}

async function loadTokenVerifier(
  issuerUrl: string,
  getRequestInit?: () => Promise<RequestInit>,
): Promise<TokenVerifier> {
  logger.info('loading OpenID verifier metadata for issuer "%s"', issuerUrl)

  const requestInit = await getRequestInit?.()
  const discoveryDocument = await fetchOpenIdConfiguration(issuerUrl, requestInit)
  const keySetOptions = requestInit
    ? {
        [customFetch]: createRequestInitAwareFetch(requestInit),
      }
    : undefined

  return {
    issuer: discoveryDocument.issuer,
    keySet: createRemoteJWKSet(new URL(discoveryDocument.jwks_uri), keySetOptions),
  }
}

async function fetchOpenIdConfiguration(
  issuerUrl: string,
  requestInit?: RequestInit,
): Promise<OpenIdConfiguration> {
  const baseIssuerUrl = issuerUrl.endsWith("/") ? issuerUrl.slice(0, -1) : issuerUrl
  const openIdConfigurationUrl = `${baseIssuerUrl}/.well-known/openid-configuration`

  logger.info('fetching OpenID configuration from "%s"', openIdConfigurationUrl)

  const response = await fetch(openIdConfigurationUrl, requestInit)

  if (!response.ok) {
    throw new Error(
      `Failed to fetch OpenID configuration from "${openIdConfigurationUrl}": ${response.status}`,
    )
  }

  const discoveryDocumentJson = await response.json()
  const discoveryDocumentResult = openIdConfigurationSchema.safeParse(discoveryDocumentJson)
  if (!discoveryDocumentResult.success) {
    throw new Error(
      `Invalid OpenID configuration format from "${openIdConfigurationUrl}": ${discoveryDocumentResult.error}`,
    )
  }

  if (discoveryDocumentResult.data.issuer !== issuerUrl) {
    throw new Error(
      `OpenID configuration issuer mismatch: expected "${issuerUrl}", got "${discoveryDocumentResult.data.issuer}"`,
    )
  }

  logger.info('OpenID configuration loaded successfully for issuer "%s"', issuerUrl)

  return discoveryDocumentResult.data
}

function createRequestInitAwareFetch(baseRequestInit: RequestInit) {
  return async (
    url: string,
    options: {
      headers: Headers
      method: "GET"
      redirect: "manual"
      signal: AbortSignal
    },
  ): Promise<Response> => {
    const headers = new Headers(options.headers)
    const requestInitHeaders = new Headers(baseRequestInit.headers)

    requestInitHeaders.forEach((value, key) => {
      headers.set(key, value)
    })

    return await fetch(url, {
      ...baseRequestInit,
      ...options,
      headers,
    })
  }
}
