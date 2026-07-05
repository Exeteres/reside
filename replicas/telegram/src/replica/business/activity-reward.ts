import type { Client } from "@temporalio/client"
import { DEFAULT_TEMPORAL_TASK_QUEUE } from "@reside/common"
import { WorkflowExecutionAlreadyStartedError, WorkflowIdReusePolicy } from "@temporalio/client"
import {
  TELEGRAM_ACTIVITY_REWARD_WORKFLOW_ID,
  TELEGRAM_ACTIVITY_REWARD_WORKFLOW_TYPE,
} from "../../definitions"

export async function startActivityRewardWorkflow(temporalClient: Client): Promise<void> {
  try {
    await temporalClient.workflow.start(TELEGRAM_ACTIVITY_REWARD_WORKFLOW_TYPE, {
      workflowId: TELEGRAM_ACTIVITY_REWARD_WORKFLOW_ID,
      taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
    })
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      return
    }

    throw error
  }
}
