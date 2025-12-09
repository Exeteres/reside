import { defineManifest } from "@reside/shared"
import { FactoryReplica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: FactoryReplica,

  avatarPrompt: `
    charcoal forge coat etched with modular patterns,
    floating assembly diagrams projected from gauntlets,
    brass-lit conveyor aura weaving new replicas,
    focused maker gaze framed by precision goggles
  `,
})
