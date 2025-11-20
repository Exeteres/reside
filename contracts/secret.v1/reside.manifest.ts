import { defineManifest } from "@reside/shared"
import { SecretContract } from "./src"

export default defineManifest({
  type: "contract",
  contract: SecretContract,
})
