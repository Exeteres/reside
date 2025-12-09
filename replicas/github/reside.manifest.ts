import { defineManifest } from "@reside/shared"
import { GithubReplica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: GithubReplica,

  avatarPrompt: `
    midnight navy deploy jacket with octocat emblem,
    holographic pull-request panes orbiting fingertips,
    neon teal diff sparks tracing commit history,
    confident collaborative stance under soft monitor glow
  `,
})
