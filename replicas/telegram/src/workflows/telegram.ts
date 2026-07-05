import {
  block,
  html,
  safeSleep,
  sendNotification,
  updateNotification,
} from "@reside/common/workflow"
import { condition, isCancellation, log, proxyActivities, setHandler } from "@temporalio/workflow"
import {
  approvalCancelSignal,
  avatarManagedBotCreatedSignal,
  type DeleteAvatarWorkflowInput,
  type EnsureReplicaAvatarWorkflowInput,
  type HandleApprovalRequestWorkflowInput,
  type TelegramActivities,
  TelegramNotificationChannels,
} from "../definitions"
import { strings } from "../locale"

const ACTIVITY_REWARD_INTERVAL_MS = 24 * 60 * 60 * 1000

const {
  completeApprovalOperation,
  failApprovalOperation,
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

export async function handleApprovalRequestWorkflow({
  operationId,
  title,
  content,
  requesterSubjectId,
}: HandleApprovalRequestWorkflowInput): Promise<void> {
  log.info("starting handleApprovalRequestWorkflow", { operationId })
  let cancelRequested = false

  setHandler(approvalCancelSignal, () => {
    cancelRequested = true
  })

  try {
    log.info("sending approval notification", { operationId })

    const notification = await sendNotification({
      system: true,
      channel: TelegramNotificationChannels.APPROVAL,
      title,
      // Content is pre-rendered HTML from access approval context.
      // Pass as MessageElement to avoid helper-level escaping.
      message: {
        html: content,
      },
      protected: true,
      sendAsSubjectId: requesterSubjectId,
      actions: {
        approve: {
          title: strings.worker.workflows.approvalActions.approve,
        },
        reject: {
          title: strings.worker.workflows.approvalActions.reject,
        },
        escalate: {
          title: strings.worker.workflows.approvalActions.escalate,
        },
      },
      cancelWhen: () => cancelRequested,
    })

    if (notification.type === "cancelled") {
      await updateNotification({
        notificationId: notification.notificationId,
        title,
        content: appendCancellationMessage(content),
        actions: {},
        requiresTextResponse: false,
      })

      await failApprovalOperation({
        operationId,
        reason: "APPROVAL_CANCELLED",
        message: strings.worker.workflows.approvalCancellationMessage,
      })

      log.info("approval operation cancelled", { operationId })
      return
    }

    if (notification.type !== "action") {
      throw new Error(`Unexpected approval notification response type: ${notification.type}`)
    }

    log.info("received notification output", {
      operationId,
      outputType: "actionName",
    })

    await completeApprovalOperation({
      operationId,
      actionName: notification.actionName,
    })

    log.info("completed approval operation", { operationId })
  } catch (error) {
    if (isCancellation(error)) {
      log.info("approval workflow received cancellation", { operationId })
      return
    }

    log.error("approval workflow failed", {
      operationId,
      error: error instanceof Error ? error.message : String(error),
    })

    const message = error instanceof Error ? error.message : String(error)

    await failApprovalOperation({
      operationId,
      reason: "APPROVAL_WORKFLOW_FAILED",
      message,
    })
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

function appendCancellationMessage(content: string): string {
  const trimmedContent = content.trim()
  if (trimmedContent.length > 0) {
    return block(html(trimmedContent), strings.worker.workflows.approvalCancellationMessage).html
  }

  return strings.worker.workflows.approvalCancellationMessage
}
