import { defineManifest } from "@reside/shared"
import { ExampleReplica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: ExampleReplica,

  avatarPrompt: "",
})
