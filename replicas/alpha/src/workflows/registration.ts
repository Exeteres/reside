import { proxyActivities, sleep } from "@temporalio/workflow"

const REGISTRATION_CHECK_INTERVAL_MS = 5_000

type RegistrationActivities = {
  reconcileRegistrationOperation(operationId: number): Promise<"completed" | "pending">
}

const activities = proxyActivities<RegistrationActivities>({
  startToCloseTimeout: "1 minute",
  scheduleToCloseTimeout: "10 minutes",
  retry: {
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
  },
})

export async function waitForReplicaRegistrationWorkflow(operationId: number): Promise<void> {
  while (true) {
    const status = await activities.reconcileRegistrationOperation(operationId)
    if (status === "completed") {
      return
    }

    await sleep(REGISTRATION_CHECK_INTERVAL_MS)
  }
}
