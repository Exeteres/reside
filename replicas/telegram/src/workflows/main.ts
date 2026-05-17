import {
  block,
  deliverOperationCompletionWorkflow,
  html,
  sendNotification,
  updateNotification,
} from "@reside/common/workflow"
import {
  condition,
  defineSignal,
  isCancellation,
  log,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow"
import { TELEGRAM_APPROVAL_CANCEL_SIGNAL, TelegramNotificationChannels } from "../definitions"
import { strings } from "../locale"

type ApprovalActionName = "approve" | "reject" | "escalate"

type WorkflowActivities = {
  completeApprovalOperation: (input: {
    operationId: number
    actionName: ApprovalActionName
  }) => Promise<void>
  failApprovalOperation: (input: {
    operationId: number
    reason: string
    message: string
  }) => Promise<void>
  getAvatarProvisionRequest: (operationId: number) => Promise<{
    operationId: number
    subjectId: string
    replicaName: string
    replicaTitle: string
    expectedPrefix: string
  }>
  getAvatarProvisioningPromptLink: (input: { operationId: number }) => Promise<string>
  completeAvatarProvisionOperation: (input: {
    operationId: number
    managedBotId: string
    managedBotUsername: string
  }) => Promise<void>
  failAvatarProvisionOperation: (input: {
    operationId: number
    reason: string
    message: string
  }) => Promise<void>
}

const activities = proxyActivities<WorkflowActivities>({
  scheduleToCloseTimeout: "5 minutes",
})

const cancelApprovalSignal = defineSignal(TELEGRAM_APPROVAL_CANCEL_SIGNAL)
const avatarManagedBotCreatedSignal =
  defineSignal<
    [
      {
        managedBotId: string
        managedBotUsername: string
      },
    ]
  >("avatarManagedBotCreated")

export { deliverOperationCompletionWorkflow }

export async function handleApprovalRequestWorkflow(input: {
  operationId: number
  title: string
  content: string
  requesterSubjectId: string
}): Promise<void> {
  log.info("starting handleApprovalRequestWorkflow", { operationId: input.operationId })
  let cancelRequested = false

  setHandler(cancelApprovalSignal, () => {
    cancelRequested = true
  })

  try {
    log.info("sending approval notification", { operationId: input.operationId })

    const notification = await sendNotification({
      system: true,
      channel: TelegramNotificationChannels.APPROVAL,
      title: input.title,
      // Content is pre-rendered HTML from access approval context.
      // Pass as MessageElement to avoid helper-level escaping.
      message: {
        html: input.content,
      },
      protected: true,
      sendAsSubjectId: input.requesterSubjectId,
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
        title: input.title,
        content: appendCancellationMessage(input.content),
        actions: {},
        requiresTextResponse: false,
      })

      await activities.failApprovalOperation({
        operationId: input.operationId,
        reason: "APPROVAL_CANCELLED",
        message: strings.worker.workflows.approvalCancellationMessage,
      })

      log.info("approval operation cancelled", { operationId: input.operationId })
      return
    }

    log.info("received notification output", {
      operationId: input.operationId,
      outputType: "actionName",
    })

    await activities.completeApprovalOperation({
      operationId: input.operationId,
      actionName: notification.actionName,
    })

    log.info("completed approval operation", { operationId: input.operationId })
  } catch (error) {
    if (isCancellation(error)) {
      log.info("approval workflow received cancellation", { operationId: input.operationId })
      return
    }

    log.error("approval workflow failed", {
      operationId: input.operationId,
      error: error instanceof Error ? error.message : String(error),
    })

    const message = error instanceof Error ? error.message : String(error)

    await activities.failApprovalOperation({
      operationId: input.operationId,
      reason: "APPROVAL_WORKFLOW_FAILED",
      message,
    })
  }
}

export async function ensureReplicaAvatarWorkflow(input: { operationId: number }): Promise<void> {
  log.info("starting ensureReplicaAvatarWorkflow", { operationId: input.operationId })

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
    const request = await activities.getAvatarProvisionRequest(input.operationId)
    const requestLink = await activities.getAvatarProvisioningPromptLink({
      operationId: input.operationId,
    })

    const notification = await sendNotification({
      channel: TelegramNotificationChannels.AVATAR_PROVISIONING,
      title: strings.worker.workflows.avatarProvisioning.title(request.replicaTitle),
      message: strings.worker.workflows.avatarProvisioning.content,
      system: true,
      actions: {
        open_create_avatar_link: {
          title: strings.worker.workflows.avatarProvisioning.openCreationLink,
          url: requestLink,
        },
      },
    })

    const signalReceived = await condition(() => managedBotCreated !== undefined, "24 hours")

    if (!signalReceived || !managedBotCreated) {
      await activities.failAvatarProvisionOperation({
        operationId: input.operationId,
        reason: "AVATAR_CREATION_TIMEOUT",
        message: strings.worker.workflows.avatarProvisioning.timeoutMessage,
      })
      return
    }

    await activities.completeAvatarProvisionOperation({
      operationId: input.operationId,
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

    await activities.failAvatarProvisionOperation({
      operationId: input.operationId,
      reason: "AVATAR_CREATION_FAILED",
      message,
    })
  }
}

function appendCancellationMessage(content: string): string {
  const trimmedContent = content.trim()
  if (trimmedContent.length > 0) {
    return block(html(trimmedContent), strings.worker.workflows.approvalCancellationMessage).html
  }

  return strings.worker.workflows.approvalCancellationMessage
}
