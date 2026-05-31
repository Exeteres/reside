import { createCommandHandlerWorkflow } from "@reside/common/workflow"
import { resetReplicaNodeCommandHandler, setReplicaNodeCommandHandler } from "./replica-node"
import { replicasCommandHandler } from "./replicas"

export const handleCommandWorkflow = createCommandHandlerWorkflow([
  replicasCommandHandler,
  setReplicaNodeCommandHandler,
  resetReplicaNodeCommandHandler,
])
