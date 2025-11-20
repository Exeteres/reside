import { defineManifest } from "@reside/shared"
import { TelegramReplica } from "./src/replica"

export default defineManifest({
  type: "replica",
  replica: TelegramReplica,
})
