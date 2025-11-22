import type { SecretValueBox } from "@contracts/secret.v1"
import { GoogleGenAI } from "@google/genai"
import { singleConcurrencyFireAndForget, startReplica } from "@reside/shared"
import { createComposer } from "./composer"
import { config } from "./config"
import { handler } from "./handler"
import { AIReplica } from "./replica"
import { AIService } from "./service"

const {
  implementations: { telegramHandler },
  requirements: { secret, telegram },
  replicaName,
  logger,
} = await startReplica(AIReplica)

const ai = new AIService()
const composer = createComposer(ai, logger)

await config.init(secret.data, replicaName, logger)
await handler.init(telegram, telegramHandler, replicaName, composer, logger)

const configHandler = singleConcurrencyFireAndForget(
  async (box: SecretValueBox<{ geminiToken?: string; geminiModel?: string }>) => {
    if (!box.value.geminiToken) {
      logger.warn("no gemini token configured, ai services will be disabled")
      ai.setClient(undefined)
      return
    }

    const client = new GoogleGenAI({ apiKey: box.value.geminiToken })

    ai.setClient(client)
    ai.setModel(box.value.geminiModel)

    logger.info("google genai client initialized")
  },
)

const configBox = await config.getBox()
if (!configBox) {
  throw new Error("AI config box not found")
}

configBox.$jazz.subscribe(configHandler)
