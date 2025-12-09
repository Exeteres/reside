import { defineManifest } from "@reside/shared"
import { FactoryContract } from "./src"

export default defineManifest({
  type: "contract",
  contract: FactoryContract,
})
