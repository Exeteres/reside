import { createCommandHandlerWorkflow } from "@reside/common/workflow"
import { betCommandHandler } from "./casino"

export const handleCommandWorkflow = createCommandHandlerWorkflow([betCommandHandler])
