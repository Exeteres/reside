import { defineManifest } from "@reside/shared"
import { ExampleContract } from "./src"

export default defineManifest({
  type: "contract",
  contract: ExampleContract,
})
