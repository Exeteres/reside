import { defineManifest } from "@reside/shared"
import { StreamerReplica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: StreamerReplica,

  avatarPrompt: `
    midnight violet stage-light accents,
    shoulder-slung media harness with holographic camera rig,
    floating live chat ticker projected at her side,
    boom microphone clipped to headset,
    exuberant showrunner energy
  `,

  packages: ["ffmpeg", "chromium"],
})
