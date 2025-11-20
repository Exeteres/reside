import { defineManifest } from "@reside/shared"
import { SillyReplica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: SillyReplica,
})
