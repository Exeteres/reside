import { defineManifest } from "@reside/shared"
import { UserManagerContract } from "./src"

export default defineManifest({
  type: "contract",
  contract: UserManagerContract,
})
