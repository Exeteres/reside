import type {
  DeleteReplicaFromClusterWorkflowInput,
  NotifyReplicaReleaseNotesWorkflowInput,
  RegistrationActivities,
  UnregisterReplicaWorkflowInput,
  WaitForReplicaRegistrationWorkflowInput,
} from "../definitions"
import { block, bold, inline, SPACE, safeSleep, sendNotification } from "@reside/common/workflow"
import { proxyActivities } from "@temporalio/workflow"
import { AlphaNotificationChannels } from "../definitions"
import { strings } from "../locale"

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

const { updateReplicaAvatarVersionTag } = proxyActivities<
  Pick<RegistrationActivities, "updateReplicaAvatarVersionTag">
>({
  startToCloseTimeout: "1 minute",
  scheduleToCloseTimeout: "5 minutes",
  retry: {
    initialInterval: "10 second",
    backoffCoefficient: 2,
    maximumInterval: "60 seconds",
  },
})

const { unregisterReplica, deleteReplicaFromCluster, completeOperation, failOperation } =
  proxyActivities<
    Pick<
      RegistrationActivities,
      "unregisterReplica" | "deleteReplicaFromCluster" | "completeOperation" | "failOperation"
    >
  >({
    scheduleToCloseTimeout: "5 minutes",
  })

export async function waitForReplicaRegistrationWorkflow({
  operationId,
}: WaitForReplicaRegistrationWorkflowInput): Promise<void> {
  while (true) {
    const { failureMessage, status } = await reconcileRegistrationOperation({ operationId })
    if (status === "completed") {
      return
    }

    if (status === "failed") {
      throw new Error(failureMessage ?? "Replica registration failed")
    }

    await safeSleep(REGISTRATION_CHECK_INTERVAL_MS)
  }
}

export async function notifyReplicaReleaseNotesWorkflow({
  replicaName,
  replicaTitle,
  oldVersion,
  newVersion,
  changes,
}: NotifyReplicaReleaseNotesWorkflowInput): Promise<void> {
  await updateReplicaAvatarVersionTag({
    replicaName,
    newVersion,
  })

  const normalizedChanges = changes?.trim()

  await sendNotification({
    channel: AlphaNotificationChannels.RELEASE_NOTES,
    title: strings.workflows.releaseNotes.title,
    system: true,
    message: block(
      inline(bold(strings.workflows.releaseNotes.replicaLabel), SPACE, replicaTitle),
      inline(
        bold(strings.workflows.releaseNotes.versionLabel),
        SPACE,
        oldVersion === null ? `v${newVersion}` : `v${oldVersion} -> v${newVersion}`,
      ),
      ...(normalizedChanges
        ? ["", bold(strings.workflows.releaseNotes.changesLabel), normalizedChanges]
        : []),
    ),
  })
}

export async function unregisterReplicaWorkflow({
  operationId,
  replicaName,
}: UnregisterReplicaWorkflowInput): Promise<void> {
  try {
    await unregisterReplica({ replicaName })
    await completeOperation({ operationId })
  } catch (error) {
    await failOperation({
      operationId,
      reason: "REAPER_ACTION_FAILED",
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export async function deleteReplicaFromClusterWorkflow({
  operationId,
  replicaName,
}: DeleteReplicaFromClusterWorkflowInput): Promise<void> {
  try {
    await deleteReplicaFromCluster({ replicaName })
    await completeOperation({ operationId })
  } catch (error) {
    await failOperation({
      operationId,
      reason: "REAPER_ACTION_FAILED",
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
