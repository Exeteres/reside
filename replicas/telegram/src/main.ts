import type { SecretValueBox } from "@contracts/secret.v1"
import type { Bot } from "grammy"
import type { ApiResponse } from "grammy/types"
import { TelegramRealm } from "@contracts/telegram.v1"
import { singleConcurrencyFireAndForget, startReplica } from "@reside/shared"
import { setupTelegramBot } from "./bot"
import { config } from "./config"
import { TelegramReplica } from "./replica"
import { filterOutBotToken } from "./utils"

const {
  replicaName,
  implementations: { telegram },
  requirements: { secret, userManager },
  logger,
} = await startReplica(TelegramReplica)

await config.init(secret.data, replicaName, logger)
await TelegramRealm.init(userManager, logger)

const configBox = await config.getBox()
if (!configBox) {
  throw new Error("Telegram config box not found")
}

let currentBot: Bot | undefined

const configHandler = singleConcurrencyFireAndForget(
  async (box: SecretValueBox<{ botToken?: string }>) => {
    if (currentBot) {
      logger.info("stopping existing Telegram bot instance")

      await currentBot.stop()
    }

    if (!box.value.botToken) {
      logger.warn("bot token is not set in the config, bot will not be started")
      currentBot = undefined
      return
    }

    currentBot = await setupTelegramBot(telegram.data, box.value.botToken, logger)
  },
)

configBox.$jazz.subscribe(configHandler)

telegram.handleCallBotApi(async ({ methodName, headers, bodyType, body }) => {
  if (!currentBot?.token) {
    throw new Error(
      "Telegram bot is not initialized. Ensure that the bot token is set in the config.",
    )
  }

  const url = `https://api.telegram.org/bot${currentBot.token}/${methodName}`

  let _body: string | Buffer
  if (bodyType === "base64") {
    _body = Buffer.from(body, "base64")
  } else {
    _body = body
  }

  // TODO: log the body type and replica name requesting the method
  logger.debug('calling Telegram Bot API method "%s" with body type "%s"', methodName, bodyType)

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: _body,
  })

  const output = await response.json()

  // for cases like getFile where file urls contain the bot token
  // TODO: for such case we should download the file and re-upload it via reside-managed storage
  const filtered = filterOutBotToken(output, currentBot.token) as ApiResponse<unknown>

  return { result: filtered }
})
