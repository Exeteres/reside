import { createCommandHandlerWorkflow } from "@reside/common/workflow"
import {
  balanceCommandHandler,
  issueReplicaFundsCommandHandler,
  transactionsCommandHandler,
  transferCommandHandler,
} from "./bank"

export const handleCommandWorkflow = createCommandHandlerWorkflow([
  balanceCommandHandler,
  transactionsCommandHandler,
  transferCommandHandler,
  issueReplicaFundsCommandHandler,
])
