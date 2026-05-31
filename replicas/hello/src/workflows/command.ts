import { createCommandHandlerWorkflow } from "@reside/common/workflow"
import { helloCommandHandler } from "./hello"

export const handleCommandWorkflow = createCommandHandlerWorkflow([helloCommandHandler])
