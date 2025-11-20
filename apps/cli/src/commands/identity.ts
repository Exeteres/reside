import { defineCommand } from "citty"
import { getOrCreateAgeIdentity } from "../shared/identity"
import { logger } from "../shared"
import { identityToRecipient } from "age-encryption"

export const identityCommand = defineCommand({
  meta: {
    description:
      "Shows the identity of the current machine. Can be used to authorize accounts for use with this machine.",
  },

  async run() {
    const identity = await getOrCreateAgeIdentity()
    const recipient = await identityToRecipient(identity)

    logger.info({ success: true }, "identity: %s", recipient)
  },
})
