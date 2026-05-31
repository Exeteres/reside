import { createCommandHandlerWorkflow } from "@reside/common/workflow"
import { rateCommandHandler } from "./rate"

export const handleCommandWorkflow = createCommandHandlerWorkflow([rateCommandHandler])
