import { createCommandHandlerWorkflow } from "@reside/common/workflow"
import { notcompelCommandHandler } from "./notcompel"

export const handleCommandWorkflow = createCommandHandlerWorkflow([notcompelCommandHandler])
