import { defineManifest } from "@reside/shared"
import { TelegramReplica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: TelegramReplica,

  avatarPrompt: `
    cyan communication filaments,
    messenger bag strap crossing chest,
    paper plane hologram emitter,
    calm relay focus, responsive liaison vibe
  `,
})
