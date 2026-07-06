import { safeSleep, sendNotification, updateNotification } from "@reside/common/workflow"
import { condition, isCancellation, log, proxyActivities, setHandler } from "@temporalio/workflow"
import {
  avatarManagedBotCreatedSignal,
  type DeleteAvatarWorkflowInput,
  type EnsureReplicaAvatarWorkflowInput,
  type TelegramActivities,
  TelegramNotificationChannels,
} from "../definitions"
import { strings } from "../locale"

const ACTIVITY_REWARD_INTERVAL_MS = 24 * 60 * 60 * 1000

const {
  getAvatarProvisionRequest,
  getAvatarProvisioningPromptLink,
  completeAvatarProvisionOperation,
  deleteAvatar,
  failAvatarProvisionOperation,
  listActivityRewardIntervals,
  rewardActivityInterval,
} = proxyActivities<TelegramActivities>({
  scheduleToCloseTimeout: "5 minutes",
})

export async function rewardActivityWorkflow(): Promise<void> {
  while (true) {
    try {
      const { intervals } = await listActivityRewardIntervals()

      for (const interval of intervals) {
        try {
          await rewardActivityInterval(interval)
        } catch (error) {
          log.warn("activity reward interval failed", {
            userId: interval.userId,
            fromMessageNumber: interval.fromMessageNumber,
            toMessageNumber: interval.toMessageNumber,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    } catch (error) {
      log.warn("activity reward cycle failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    await safeSleep(ACTIVITY_REWARD_INTERVAL_MS)
  }
}

export async function ensureReplicaAvatarWorkflow({
  operationId,
}: EnsureReplicaAvatarWorkflowInput): Promise<void> {
  log.info("starting ensureReplicaAvatarWorkflow", { operationId })

  let managedBotCreated:
    | {
        managedBotId: string
        managedBotUsername: string
      }
    | undefined

  setHandler(avatarManagedBotCreatedSignal, payload => {
    managedBotCreated = payload
  })

  try {
    const request = await getAvatarProvisionRequest({
      operationId,
    })
    const requestLink = await getAvatarProvisioningPromptLink({
      operationId,
    })

    const notification = await sendNotification({
      channel: TelegramNotificationChannels.AVATAR_PROVISIONING,
      title: strings.worker.workflows.avatarProvisioning.title(request.replicaTitle),
      message: strings.worker.workflows.avatarProvisioning.content,
      system: true,
      actions: {
        open_create_avatar_link: {
          title: strings.worker.workflows.avatarProvisioning.openCreationLink,
          url: requestLink.link,
        },
      },
    })

    const signalReceived = await condition(() => managedBotCreated !== undefined, "24 hours")

    if (!signalReceived || !managedBotCreated) {
      await failAvatarProvisionOperation({
        operationId,
        reason: "AVATAR_CREATION_TIMEOUT",
        message: strings.worker.workflows.avatarProvisioning.timeoutMessage,
      })
      return
    }

    await completeAvatarProvisionOperation({
      operationId,
      managedBotId: managedBotCreated.managedBotId,
      managedBotUsername: managedBotCreated.managedBotUsername,
    })

    await updateNotification({
      notificationId: notification.notificationId,
      title: strings.worker.workflows.avatarProvisioning.createdTitle(request.replicaTitle),
      content: strings.worker.workflows.avatarProvisioning.createdContent,
      actions: {},
      requiresTextResponse: false,
    })
  } catch (error) {
    if (isCancellation(error)) {
      return
    }

    const message = error instanceof Error ? error.message : String(error)

    await failAvatarProvisionOperation({
      operationId,
      reason: "AVATAR_CREATION_FAILED",
      message,
    })
  }
}

export async function deleteAvatarWorkflow({
  operationId,
  avatarId,
  replicaName,
  avatarProvisionRequestIds,
}: DeleteAvatarWorkflowInput): Promise<void> {
  log.info("starting deleteAvatarWorkflow", { operationId })

  try {
    await deleteAvatar({
      operationId,
      avatarId,
      replicaName,
      avatarProvisionRequestIds,
    })
  } catch (error) {
    if (isCancellation(error)) {
      return
    }

    const message = error instanceof Error ? error.message : String(error)

    await failAvatarProvisionOperation({
      operationId,
      reason: "REAPER_ACTION_FAILED",
      message,
    })

    throw error
  }
}
