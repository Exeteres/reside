import { defineManifest } from "@reside/shared"
import { AlphaSecretaryReplica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: AlphaSecretaryReplica,

  avatarPrompt: `
    mint-teal communications trims,
    sleeves rolled for quick note-taking,
    holographic tablet interface modules,
    stylus-ready posture,
    diplomatic support presence
  `,
})
