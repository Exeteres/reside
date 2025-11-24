import { TelegramRealm } from "@contracts/telegram.v1"
import { startReplica } from "@reside/shared/node"
import { createComposer } from "./composer"
import { handler } from "./handler"
import { UserManagerSecretaryReplica } from "./replica"

const {
  implementations: { telegramHandler },
  requirements: { telegram, userManager, alpha },
  replicaName,
  logger,
} = await startReplica(UserManagerSecretaryReplica)

const composer = createComposer(userManager.accountId, alpha.accountId, telegram.accountId, logger)

await handler.init(telegram, telegramHandler, replicaName, composer, logger)
await TelegramRealm.init(userManager, logger)
