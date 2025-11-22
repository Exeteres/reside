import { defineManifest } from "@reside/shared"
import { KubernetesSentinel } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: KubernetesSentinel,

  avatarPrompt: `
    electric-blue tactical harness layered over hoodie,
    lightweight hex-plated shoulder armor,
    glowing kubernetes wheel emblem at chest,
    vigilant guardian demeanor
  `,
})
