import { generateIdentity } from "age-encryption"
import { logger } from "./logger"
import { AsyncEntry } from "@napi-rs/keyring"

const service = "io.reside.cli"
const secretName = "identity"

const entry = new AsyncEntry(service, secretName)

/**
 * Gets or creates a persistent identity for Age Encryption.
 *
 * It uses OS keyring to store the identity securely.
 */
export async function getOrCreateAgeIdentity(): Promise<string> {
  const existingIdentity = await entry.getPassword()
  if (existingIdentity) {
    logger.info("loading age identity from OS keyring")
    return existingIdentity
  }

  const identity = await generateIdentity()

  await entry.setPassword(identity)

  logger.info("generated new age identity and stored in OS keyring")

  return identity
}
