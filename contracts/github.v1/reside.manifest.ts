import { defineManifest } from "@reside/shared"
import { GitHubContract } from "./src"

export default defineManifest({
  type: "contract",
  contract: GitHubContract,
})
