import {
  createCommandHandlerWorkflow,
  deliverOperationCompletionWorkflow,
} from "@reside/common/workflow"
import { createTaskCommandHandler } from "./task"

export { deliverOperationCompletionWorkflow }

export const handleCommandWorkflow = createCommandHandlerWorkflow([createTaskCommandHandler])
