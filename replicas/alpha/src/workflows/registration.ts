import type {
  RegistrationActivities,
  WaitForReplicaRegistrationWorkflowInput,
} from "../definitions"
import { sleepSafely } from "@reside/common/workflow"
import { proxyActivities } from "@temporalio/workflow"

const REGISTRATION_CHECK_INTERVAL_MS = 5_000

const { reconcileRegistrationOperation } = proxyActivities<RegistrationActivities>({
  startToCloseTimeout: "1 minute",
  scheduleToCloseTimeout: "10 minutes",
  retry: {
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
  },
})

export async function waitForReplicaRegistrationWorkflow({
  operationId,
}: WaitForReplicaRegistrationWorkflowInput): Promise<void> {
  while (true) {
    const { status } = await reconcileRegistrationOperation({ operationId })
    if (status === "completed") {
      return
    }

    await sleepSafely(REGISTRATION_CHECK_INTERVAL_MS)
  }
}
