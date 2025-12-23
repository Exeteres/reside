import { defineManifest } from "@reside/shared"
import { PadoruReplica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: PadoruReplica,

  avatarPrompt: `
    chibi padoru santa cap with fluffy trim,
    swirling red cloak and white muffler fluttering,
    handheld neon countdown lantern ticking to new year,
    jingling bell ribbon at waist, playful padoru grin,
    light snow sparkle around energetic holiday charge
  `,
})
