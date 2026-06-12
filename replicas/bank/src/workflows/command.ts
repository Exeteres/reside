import { createCommandHandlerWorkflow } from "@reside/common/workflow"
import { balanceCommandHandler, historyCommandHandler, transferCommandHandler } from "./bank"

export const handleCommandWorkflow = createCommandHandlerWorkflow([
  balanceCommandHandler,
  historyCommandHandler,
  transferCommandHandler,
])
