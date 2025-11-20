import { defineManifest } from "@reside/shared"
import { TelegramContract } from "./src"

export default defineManifest({
  type: "contract",
  contract: TelegramContract,
})
