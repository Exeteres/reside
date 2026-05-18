import {
  createCommandHandlerWorkflow,
  deliverOperationCompletionWorkflow,
} from "@reside/common/workflow"
import { rateCommandHandler } from "./rate"

export { deliverOperationCompletionWorkflow }

export const handleCommandWorkflow = createCommandHandlerWorkflow([rateCommandHandler])
