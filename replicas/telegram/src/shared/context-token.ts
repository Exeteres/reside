import type { ResideCrypto } from "@reside/common/encryption"
import { z } from "zod"

const interactionContextTokenSchema = z.object({
  chat_id: z.string().trim().min(1),
  message_id: z.number().int().positive().optional(),
})

type ContextTokenPayload = z.infer<typeof interactionContextTokenSchema>

/**
 * Encrypts Telegram interaction context claims into an opaque ECID token.
 *
 * @param crypto The encryption helper.
 * @param claims The Telegram context claims.
 * @returns The encrypted opaque token.
 */
export async function createInteractionContextToken(
  crypto: ResideCrypto,
  claims: ContextTokenPayload,
): Promise<string> {
  return await crypto.encrypt(interactionContextTokenSchema.parse(claims))
}

/**
 * Decrypts an opaque interaction context token and validates Telegram claims.
 *
 * @param crypto The encryption helper.
 * @param token The encrypted interaction context token.
 * @returns The validated Telegram context claims.
 */
export async function decryptInteractionContextToken(
  crypto: ResideCrypto,
  token: string,
): Promise<ContextTokenPayload> {
  return await crypto.decrypt(interactionContextTokenSchema, token)
}
