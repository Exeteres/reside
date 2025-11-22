import { defineManifest } from "@reside/shared"
import { AIReplica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: AIReplica,

  avatarPrompt: `
    prismatic neural halo hovering above ponytail,
    translucent holo visor streaming code glyphs,
    iridescent data shawl layered over hoodie,
    luminous sapphire core suspended at chest,
    serene analytical presence
  `,
})
