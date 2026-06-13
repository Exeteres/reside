import type { createRemoteJWKSet, JWTPayload } from "jose"
import { z } from "zod"

export type ReplicaTokenPayload = JWTPayload & {
  iss?: string
  sub?: string
}

export type OpenIdConfiguration = {
  issuer: string
  jwks_uri: string
}

export type TokenVerifier = {
  issuer: string
  keySet: ReturnType<typeof createRemoteJWKSet>
}

export type IssuerDefinition = {
  realName: string
  getRequestInit?: () => Promise<RequestInit>
  extractSubjectName: (sub: string) => string
}

export type AuthenticationResult<TRealm extends string = string> = {
  /**
   * The ID of the subject in the format "{realm}:{id}".
   */
  subjectId: `${TRealm}:${string}`

  /**
   * The name of the realm extracted from the token.
   */
  realm: TRealm

  /**
   * The name of the subject within the realm, extracted from the token.
   */
  name: string
}

export const tokenPayloadSchema = z.object({
  iss: z.string().min(1),
  sub: z.string().min(1).optional(),
})

export const openIdConfigurationSchema = z.object({
  issuer: z.string().min(1),
  jwks_uri: z.string().url(),
})
