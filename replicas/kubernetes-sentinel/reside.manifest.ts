import { defineManifest } from "@reside/shared"
import { KubernetesSentinel } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: KubernetesSentinel,
})
