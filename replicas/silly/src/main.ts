import { startReplica } from "@reside/shared/node"
import { createComposer } from "./composer"
import { handler } from "./handler"
import { SillyReplica } from "./replica"

const {
  implementations: { telegramHandler },
  requirements: { telegram },
  replicaName,
  logger,
} = await startReplica(SillyReplica)

const composer = createComposer(logger)

await handler.init(telegram, telegramHandler, replicaName, composer, logger)
