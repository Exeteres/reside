import type { Client as TemporalClient } from "@temporalio/client"
import { randomUUID } from "node:crypto"
import { defineTool } from "@github/copilot-sdk"
import { DEFAULT_TEMPORAL_TASK_QUEUE, getReplicaName } from "@reside/common"
import { z } from "zod"
import { createTaskCommand } from "../../definitions"

const TASK_MESSAGE_LINK_QUERY = "taskMessageLink"
const TASK_MESSAGE_LINK_WAIT_TIMEOUT_MS = 120_000
const TASK_MESSAGE_LINK_POLL_INTERVAL_MS = 1_000

type CreateTaskToolServices = {
  temporalClient: TemporalClient
}

export function createCreateTaskTool({ temporalClient }: CreateTaskToolServices) {
  return defineTool("create_task", {
    description: "Starts create_task workflow for the provided task description.",
    parameters: z.object({
      task: z.string().min(1),
      mode: z.enum(["plan", "implement"]).default("plan"),
    }),
    handler: async ({ task, mode }) => {
      const invocationId = randomUUID()
      const taskPrompt = task.trim()
      const workflowId = `handle-command-${invocationId}`

      await temporalClient.workflow.start("handleCommandWorkflow", {
        workflowId,
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        args: [
          {
            invocationId,
            command: createTaskCommand,
            parameters: {
              task: taskPrompt,
              mode,
            },
            subjectId: `replica:${getReplicaName()}`,
          },
        ],
      })

      const messageLink = await waitForTaskMessageLink(temporalClient, workflowId)

      return {
        invocationId,
        status: "started",
        messageLink,
        response: "Started create_task workflow.",
      }
    },
  })
}

async function waitForTaskMessageLink(
  temporalClient: TemporalClient,
  workflowId: string,
): Promise<string> {
  const startedAt = Date.now()
  const handle = temporalClient.workflow.getHandle(workflowId)

  while (Date.now() - startedAt < TASK_MESSAGE_LINK_WAIT_TIMEOUT_MS) {
    const messageLink = await handle.query<string | undefined>(TASK_MESSAGE_LINK_QUERY)
    if (messageLink !== undefined && messageLink.length > 0) {
      return messageLink
    }

    await sleep(TASK_MESSAGE_LINK_POLL_INTERVAL_MS)
  }

  throw new Error(`Task workflow "${workflowId}" did not create a message link in time`)
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}
