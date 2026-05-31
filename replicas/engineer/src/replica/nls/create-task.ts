import type { Client as TemporalClient } from "@temporalio/client"
import { randomUUID } from "node:crypto"
import { defineTool } from "@github/copilot-sdk"
import { DEFAULT_TEMPORAL_TASK_QUEUE, getReplicaName } from "@reside/common"
import { z } from "zod"
import { createTaskCommand } from "../../definitions"

type CreateTaskToolServices = {
  temporalClient: TemporalClient
}

export function createCreateTaskTool({ temporalClient }: CreateTaskToolServices) {
  return defineTool("create_task", {
    description: "Starts create_task workflow for the provided task description.",
    parameters: z.object({
      task: z.string().min(1),
    }),
    handler: async ({ task }) => {
      const invocationId = randomUUID()
      const taskPrompt = task.trim()

      await temporalClient.workflow.start("handleCommandWorkflow", {
        workflowId: `handle-command-${invocationId}`,
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        args: [
          {
            invocationId,
            command: createTaskCommand,
            parameters: {
              task: taskPrompt,
            },
            subjectId: `replica:${getReplicaName()}`,
          },
        ],
      })

      return {
        invocationId,
        status: "started",
        response: "Started create_task workflow.",
      }
    },
  })
}
