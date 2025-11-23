import type { SecretValueBox } from "@contracts/secret.v1"
import { singleConcurrencyFireAndForget, startReplica } from "@reside/shared"
import { createComposer } from "./composer"
import { config } from "./config"
import { handler } from "./handler"
import { StreamerReplica } from "./replica"
import { StreamerService } from "./service"
import { createStream } from "./stream"

const {
  implementations: { telegramHandler },
  requirements: { secret, telegram },
  replicaName,
  logger,
} = await startReplica(StreamerReplica)

const stream = await createStream()
logger.info("stream started")

const streamer = new StreamerService(stream, logger)
const composer = createComposer(streamer, logger)

await config.init(secret.data, replicaName, logger)
await handler.init(telegram, telegramHandler, replicaName, composer, logger)

const configHandler = singleConcurrencyFireAndForget(
  async (box: SecretValueBox<{ targets?: Record<string, string> }>) => {
    streamer.updateTargets(box.value.targets ?? {})

    logger.info("streamer targets updated from config")
  },
)

const configBox = await config.getBox()
if (!configBox) {
  throw new Error("Config box not found")
}

configBox.$jazz.subscribe(configHandler)
