import { createCommandHandlerWorkflow } from "@reside/common/workflow"
import {
  balanceCommandHandler,
  securityAuditCommandHandler,
  transactionsCommandHandler,
  transferCommandHandler,
} from "./bank"

export const handleCommandWorkflow = createCommandHandlerWorkflow([
  balanceCommandHandler,
  transactionsCommandHandler,
  securityAuditCommandHandler,
  transferCommandHandler,
])
