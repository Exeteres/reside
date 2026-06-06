import type {
  NotifyReplicaReleaseNotesWorkflowInput,
  RegistrationActivities,
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

export async function waitForReplicaRegistrationWorkflow({
  operationId,
}: WaitForReplicaRegistrationWorkflowInput): Promise<void> {
  while (true) {
    const { status } = await reconcileRegistrationOperation({ operationId })
    if (status === "completed") {
      return
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
        ? [bold(strings.workflows.releaseNotes.changesLabel), normalizedChanges]
        : []),
    ),
  })
}
