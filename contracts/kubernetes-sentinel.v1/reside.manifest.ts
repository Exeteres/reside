import { defineManifest } from "@reside/shared"
import { KubernetesSentinelContract } from "./src"

export default defineManifest({
  type: "contract",
  contract: KubernetesSentinelContract,
})
