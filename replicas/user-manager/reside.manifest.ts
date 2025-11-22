import { defineManifest } from "@reside/shared"
import { UserManagerReplica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: UserManagerReplica,

  avatarPrompt: `
    burgundy administrative piping,
    hovering roster clipboard,
    access badge controller,
    steady welcoming stance,
    reassuring managerial poise
  `,
})
