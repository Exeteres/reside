import { logger } from "@reside/common"
import { assertDatabaseReplicaHealth } from "./checks"
import { createDatabaseE2EContext } from "./context"

const context = await createDatabaseE2EContext()

logger.info({ namespace: context.namespace }, "starting database replica e2e")

await assertDatabaseReplicaHealth(context)

logger.info({ namespace: context.namespace }, "database replica e2e completed successfully")
