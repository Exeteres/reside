import { defineManifest } from "@reside/shared"
import { TelegramHandlerContract } from "./src"

export default defineManifest({
  type: "contract",
  contract: TelegramHandlerContract,
})
