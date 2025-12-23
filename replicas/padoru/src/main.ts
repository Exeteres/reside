import { startReplica } from "@reside/shared/node"
import { createComposer } from "./composer"
import { startCountdown } from "./countdown"
import { handler } from "./handler"
import { PadoruReplica } from "./replica"

const {
  replicaName,
  account,
  implementations: { telegramHandler },
  requirements: { telegram },
  logger,
} = await startReplica(PadoruReplica)

const loadedAccount = await account.$jazz.ensureLoaded({ resolve: { root: true } })

const composer = createComposer(loadedAccount.root, logger)
await handler.init(telegram, telegramHandler, replicaName, composer, logger)

await startCountdown(loadedAccount.root, handler.api, logger)
