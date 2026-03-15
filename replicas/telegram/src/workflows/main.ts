import type { SubscribeToOperationCompletionResponse } from "@reside/api/common/operation.v1"
import type { NotificationResponse } from "@reside/api/interaction/notification.v1"
import {
  block,
  deliverOperationCompletionWorkflow,
  html,
  waitForOperationResult,
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

type WorkflowActivities = {
  sendNotification: (input: {
    contextId: string
    channel: TelegramNotificationChannels
    title: string
    content: string
    protected: boolean
    sendAsSubjectId: string
    actions: Array<{
      name: string
      title: string
    }>
  }) => Promise<{
    notificationId: number
    operation?: {
      id: number
    }
  }>
  subscribeToOperationCompletion: (
    operationId: number,
    workflowId: string,
  ) => Promise<SubscribeToOperationCompletionResponse>
  updateNotification: (input: {
    notificationId: number
    title: string
    content: string
    actions: []
    requiresTextResponse: false
  }) => Promise<void>
  completeApprovalOperation: (input: {
    operationId: number
    notificationResponse: NotificationResponse
  }) => Promise<void>
  failApprovalOperation: (input: {
    operationId: number
    reason: string
    message: string
  }) => Promise<void>
}

const activities = proxyActivities<WorkflowActivities>({
  scheduleToCloseTimeout: "5 minutes",
})

const APPROVAL_CONTEXT_ID = "1"
const cancelApprovalSignal = defineSignal(TELEGRAM_APPROVAL_CANCEL_SIGNAL)

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

    const notification = await activities.sendNotification({
      contextId: APPROVAL_CONTEXT_ID,
      channel: TelegramNotificationChannels.APPROVAL,
      title: input.title,
      content: input.content,
      protected: true,
      sendAsSubjectId: input.requesterSubjectId,
      actions: [
        {
          name: "approve",
          title: strings.worker.workflows.approvalActions.approve,
        },
        {
          name: "reject",
          title: strings.worker.workflows.approvalActions.reject,
        },
        {
          name: "escalate",
          title: strings.worker.workflows.approvalActions.escalate,
        },
      ],
    })

    if (!notification.operation) {
      throw new Error("Approval notification must return a pending response operation")
    }

    const approvalResponsePromise = waitForOperationResult<NotificationResponse>(
      notification.operation.id,
      activities.subscribeToOperationCompletion,
    )

    const cancellationPromise = condition(() => cancelRequested).then(() => {
      return {
        type: "cancelled" as const,
      }
    })

    const completionPromise = approvalResponsePromise.then(notificationResponse => {
      return {
        type: "response" as const,
        notificationResponse,
      }
    })

    const outcome = await Promise.race([completionPromise, cancellationPromise])

    if (outcome.type === "cancelled") {
      await activities.updateNotification({
        notificationId: notification.notificationId,
        title: input.title,
        content: appendCancellationMessage(input.content),
        actions: [],
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
      outputType: outcome.notificationResponse.response?.$case,
    })

    await activities.completeApprovalOperation({
      operationId: input.operationId,
      notificationResponse: outcome.notificationResponse,
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

function appendCancellationMessage(content: string): string {
  const trimmedContent = content.trim()
  if (trimmedContent.length > 0) {
    return block(html(trimmedContent), strings.worker.workflows.approvalCancellationMessage).html
  }

  return strings.worker.workflows.approvalCancellationMessage
}
