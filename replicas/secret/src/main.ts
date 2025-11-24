import { startReplica } from "@reside/shared/node"
import { SecretReplica } from "./replica"

// this replica is fully implemented by its contract: it only stores data and manages permissions

await startReplica(SecretReplica)
