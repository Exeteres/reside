import { createCommandHandlerWorkflow } from "@reside/common/workflow"
import { imageCommandHandler } from "./ai"

export const handleCommandWorkflow = createCommandHandlerWorkflow([imageCommandHandler])
