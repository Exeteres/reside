import { proxyActivities } from "@temporalio/workflow"

type OperationNotificationActivities = {
  deliverOperationCompletion: (input: { operationId: number }) => Promise<void>
}

const activities = proxyActivities<OperationNotificationActivities>({
  startToCloseTimeout: "30 seconds",
  retry: {
    initialInterval: "1 second",
    maximumInterval: "5 minutes",
    backoffCoefficient: 2,
    maximumAttempts: 100,
  },
})

export async function deliverOperationCompletionWorkflow(input: {
  operationId: number
}): Promise<void> {
  await activities.deliverOperationCompletion(input)
}
