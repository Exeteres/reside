import { defineManifest } from "@reside/shared"
import { AlphaSecretaryReplica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: AlphaSecretaryReplica,
})
