import { TelegramRealm } from "@contracts/telegram.v1"
import { startReplica } from "@reside/shared"
import { createComposer } from "./composer"
import { handler } from "./handler"
import { UserManagerSecretaryReplica } from "./replica"

const {
  implementations: { telegramHandler },
  requirements: { telegram, userManager },
  replicaName,
  logger,
} = await startReplica(UserManagerSecretaryReplica)

const composer = createComposer(userManager.accountId, logger)

await handler.init(telegram, telegramHandler, replicaName, composer, logger)
await TelegramRealm.init(userManager, logger)
