import { defineManifest } from "@reside/shared"
import { SillyReplica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: SillyReplica,

  avatarPrompt: `
    bubblegum pink glow striping,
    playful holographic stickers,
    emoji drone companion at shoulder,
    whimsical tester spirit,
    vibrant mischief energy
  `,
})
