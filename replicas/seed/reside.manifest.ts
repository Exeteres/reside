import { defineManifest } from "@reside/shared"
import { replica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica,

  testingPackages: ["regclient"],
})
