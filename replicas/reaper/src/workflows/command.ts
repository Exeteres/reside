import { createCommandHandlerWorkflow } from "@reside/common/workflow"
import { killCommandHandler } from "./reaper"

export const handleCommandWorkflow = createCommandHandlerWorkflow([killCommandHandler])
