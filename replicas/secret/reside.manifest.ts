import { defineManifest } from "@reside/shared"
import { SecretReplica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: SecretReplica,

  avatarPrompt: `
    deep violet cloak panels,
    encrypted lock hologram emitter,
    silver circuitry gloves,
    misty secrecy aura,
    composed and enigmatic
  `,
})
