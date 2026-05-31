import type { Client as TemporalClient } from "@temporalio/client"
import { DEFAULT_TEMPORAL_TASK_QUEUE } from "@reside/common"
import { resetReplicaNodeCommand, setReplicaNodeCommand } from "../../definitions"

export async function startSetReplicaNodeCommand(
  temporalClient: TemporalClient,
  invocationId: string,
  subjectId: string,
  replicaName: string,
  nodeName: string,
): Promise<void> {
  await temporalClient.workflow.start("handleCommandWorkflow", {
    workflowId: `handle-command-${invocationId}`,
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    args: [
      {
        invocationId,
        command: setReplicaNodeCommand,
        parameters: {
          replica: replicaName,
          node: nodeName,
        },
        subjectId,
      },
    ],
  })
}

export async function startResetReplicaNodeCommand(
  temporalClient: TemporalClient,
  invocationId: string,
  subjectId: string,
  replicaName: string,
): Promise<void> {
  await temporalClient.workflow.start("handleCommandWorkflow", {
    workflowId: `handle-command-${invocationId}`,
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    args: [
      {
        invocationId,
        command: resetReplicaNodeCommand,
        parameters: {
          replica: replicaName,
        },
        subjectId,
      },
    ],
  })
}
