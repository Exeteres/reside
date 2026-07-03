import type { Client as TemporalClient } from "@temporalio/client"
import type { PrepareTaskWorkflowOutput, TaskCreationMode } from "../../definitions"
import { randomUUID } from "node:crypto"
import { DEFAULT_TEMPORAL_TASK_QUEUE, defineTool, getReplicaName } from "@reside/common"
import { z } from "zod"

type CreateTaskToolServices = {
  temporalClient: TemporalClient
}

export function createCreateTaskTool({ temporalClient }: CreateTaskToolServices) {
  return defineTool("create_task", {
    description: "Prepares an engineer task topic and starts task processing workflow.",
    parameters: z.object({
      task: z.string().min(1),
      mode: z.enum(["plan", "implement"]).default("plan"),
    }),
    handler: async ({ task, mode }) => {
      const invocationId = randomUUID()
      const taskPrompt = task.trim()
      const taskMode: TaskCreationMode = mode
      const subjectId = `replica:${getReplicaName()}`

      if (taskPrompt.length === 0) {
        throw new Error("Task description must not be empty")
      }

      const preparationHandle = await temporalClient.workflow.start("prepareTaskWorkflow", {
        workflowId: `prepare-task-${invocationId}`,
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        args: [
          {
            subjectId,
            prompt: taskPrompt,
            mode: taskMode,
          },
        ],
      })
      const preparation = (await preparationHandle.result()) as PrepareTaskWorkflowOutput

      await temporalClient.workflow.start("taskWorkflow", {
        workflowId: `task-${preparation.topicId}`,
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        args: [
          {
            subjectId,
            prompt: taskPrompt,
            mode: taskMode,
            ...preparation,
          },
        ],
      })

      return {
        invocationId,
        status: "created",
        messageLink: preparation.messageLink,
        response: "Created task topic and started task workflow.",
      }
    },
  })
}
