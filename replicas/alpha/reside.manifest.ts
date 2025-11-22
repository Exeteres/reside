import { defineManifest } from "@reside/shared"
import { AlphaReplica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: AlphaReplica,

  avatarPrompt: `
    golden command sash draped across hoodie,
    holographic epaulets emitting soft command glyphs,
    luminescent gold circuitry armband,
    aura of poised leadership
  `,

  testingPackages: ["regclient"],
})
