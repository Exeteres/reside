import { createCommandHandlerWorkflow } from "@reside/common/workflow"
import { createTaskCommandHandler } from "./task"

export const handleCommandWorkflow = createCommandHandlerWorkflow([createTaskCommandHandler])
