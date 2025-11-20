import { defineManifest } from "@reside/shared"
import { SecretReplica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: SecretReplica,
})
