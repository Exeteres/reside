import { TelegramRealm } from "@contracts/telegram.v1"
import { startReplica } from "@reside/shared"
import { createComposer } from "./composer"
import { handler } from "./handler"
import { AlphaSecretaryReplica } from "./replica"

const {
  implementations: { telegramHandler },
  requirements: { alpha, telegram, userManager },
  replicaName,
  logger,
} = await startReplica(AlphaSecretaryReplica)

const composer = createComposer(alpha.accountId, logger)

await handler.init(telegram, telegramHandler, replicaName, composer, logger)
await TelegramRealm.init(userManager, logger)
