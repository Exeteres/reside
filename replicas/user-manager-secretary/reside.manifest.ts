import { defineManifest } from "@reside/shared"
import { UserManagerSecretaryReplica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: UserManagerSecretaryReplica,

  avatarPrompt: `
    plum-and-rose administrative accents,
    sleek shoulder shawl striped with burgundy threads,
    dual holographic clipboards projecting user metrics,
    luminous rose-gold sash tucked at waist,
    supportive coordinator presence
  `,
})
