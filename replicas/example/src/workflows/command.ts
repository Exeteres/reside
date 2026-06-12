import { createCommandHandlerWorkflow } from "@reside/common/workflow"
import { exampleCommandHandler } from "./example"

export const handleCommandWorkflow = createCommandHandlerWorkflow([exampleCommandHandler])
