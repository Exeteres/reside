import { EncryptJWT, jwtDecrypt } from "jose"

export const TELEGRAM_INTERACTION_CONTEXT_SECRET_NAME = "interaction-context-token"
export const TELEGRAM_INTERACTION_CONTEXT_SECRET_KEY = "encryption_key"
export const TELEGRAM_INTERACTION_CONTEXT_ENV_NAME = "TELEGRAM_INTERACTION_CONTEXT_TOKEN_KEY"

const CONTEXT_TOKEN_ALG = "dir"
const CONTEXT_TOKEN_ENC = "A256GCM"

type ContextTokenPayload = {
  chat_id: string
  message_id?: number
}

/**
 * Encrypts Telegram interaction context claims into an opaque JWT token.
 *
 * @param claims The Telegram context claims.
 * @returns The encrypted opaque token.
 */
export async function createInteractionContextToken(claims: ContextTokenPayload): Promise<string> {
  const key = getInteractionContextEncryptionKey()

  return await new EncryptJWT({
    chat_id: claims.chat_id,
    message_id: claims.message_id,
  })
    .setProtectedHeader({
      alg: CONTEXT_TOKEN_ALG,
      enc: CONTEXT_TOKEN_ENC,
    })
    .setIssuedAt()
    .encrypt(key)
}

/**
 * Decrypts an opaque interaction context token and validates Telegram claims.
 *
 * @param token The encrypted interaction context token.
 * @returns The validated Telegram context claims.
 */
export async function decryptInteractionContextToken(token: string): Promise<ContextTokenPayload> {
  const key = getInteractionContextEncryptionKey()
  const { payload } = await jwtDecrypt(token, key)

  const chatId = payload.chat_id
  if (typeof chatId !== "string" || chatId.trim().length === 0) {
    throw new Error("Interaction context token does not contain valid chat_id claim")
  }

  const messageId = payload.message_id
  if (messageId === undefined) {
    return {
      chat_id: chatId,
    }
  }

  if (typeof messageId !== "number" || !Number.isInteger(messageId) || messageId <= 0) {
    throw new Error("Interaction context token contains invalid message_id claim")
  }

  return {
    chat_id: chatId,
    message_id: messageId,
  }
}

function getInteractionContextEncryptionKey(): Uint8Array {
  const encodedKey = process.env[TELEGRAM_INTERACTION_CONTEXT_ENV_NAME]?.trim()
  if (!encodedKey) {
    throw new Error(`${TELEGRAM_INTERACTION_CONTEXT_ENV_NAME} environment variable is required`)
  }

  const key = Buffer.from(encodedKey, "base64url")
  if (key.length !== 32) {
    throw new Error(`${TELEGRAM_INTERACTION_CONTEXT_ENV_NAME} must decode to 32 bytes key`)
  }

  return key
}
