import { defineManifest } from "@reside/shared"
import { AlphaReplica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: AlphaReplica,

  testingPackages: ["regclient"],
})
