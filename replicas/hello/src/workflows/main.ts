import {
  createCommandHandlerWorkflow,
  deliverOperationCompletionWorkflow,
} from "@reside/common/workflow"
import { helloCommandHandler } from "./hello"

export { deliverOperationCompletionWorkflow }

export const handleCommandWorkflow = createCommandHandlerWorkflow([helloCommandHandler])
