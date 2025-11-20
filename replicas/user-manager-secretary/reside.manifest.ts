import { defineManifest } from "@reside/shared"
import { UserManagerSecretaryReplica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: UserManagerSecretaryReplica,
})
