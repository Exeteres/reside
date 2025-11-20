import { defineManifest } from "@reside/shared"
import { UserManagerReplica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: UserManagerReplica,
})
