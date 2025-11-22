import { defineManifest } from "@reside/shared"
import { replica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica,

  avatarPrompt: `
    pastel green bioluminescent accents,
    floating seed pods orbiting,
    botanical energy motifs,
    nurturing pioneer aura,
    gentle growth symbolism
  `,

  testingPackages: ["regclient"],
})
