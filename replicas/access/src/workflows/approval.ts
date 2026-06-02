import type { ApprovalResponseJson } from "@reside/api/common/approval.v1"
import type { AccessActivities, ApprovePermissionRequestSetWorkflowInput } from "../definitions"
import {
  block,
  bold,
  deleteNotification,
  inline,
  SPACE,
  sendNotification,
  updateNotification,
  waitForOperationResult,
} from "@reside/common/workflow"
import { isCancellation, log, proxyActivities } from "@temporalio/workflow"
import { strings } from "../locale"

const {
  getApprovalContext,
  subscribeToExternalOperationCompletion,
  cancelApproverOperation,
  approvePermissionRequestSet,
  rejectPermissionRequestSet,
  failPermissionRequestSetWorkflowIfPending,
} = proxyActivities<AccessActivities>({
  scheduleToCloseTimeout: "5 minutes",
})

const { requestApproverDecision } = proxyActivities<
  Pick<AccessActivities, "requestApproverDecision">
>({
  scheduleToCloseTimeout: "5 minutes",
  // This activity creates an external approval operation, so retries can duplicate notifications.
  retry: {
    maximumAttempts: 1,
  },
})

type PreviousEscalation = {
  approverTitle: string
  resolution: string
}

type CurrentApproverOperation = {
  approverId: number
  operationId: number
}

type BuildApproverDecisionContentArgs = {
  baseContent: string
  previousEscalation: PreviousEscalation | undefined
}

export async function approvePermissionRequestSetWorkflow({
  operationId,
}: ApprovePermissionRequestSetWorkflowInput): Promise<void> {
  log.info("starting approvePermissionRequestSetWorkflow", { operationId })

  let previousEscalation: PreviousEscalation | undefined
  let currentApproverOperation: CurrentApproverOperation | undefined
  let currentNonTelegramApproverNotificationId: string | undefined

  try {
    const approvalContext = await getApprovalContext({ operationId })
    const approvers = approvalContext.approvers

    log.info("loaded approval context", { operationId, approversCount: approvers.length })

    for (const [approverIndex, approver] of approvers.entries()) {
      log.info("requesting approver decision", { operationId, approverName: approver.name })

      const { operationId: approverOperationId } = await requestApproverDecision({
        approverId: approver.id,
        title: approvalContext.title,
        content: buildApproverDecisionContent({
          baseContent: approvalContext.content,
          previousEscalation,
        }),
      })

      currentApproverOperation = {
        approverId: approver.id,
        operationId: approverOperationId,
      }

      if (!isTelegramApproverName(approver.name)) {
        const notification = await sendSystemNotificationSafely({
          title: strings.notifications.nonTelegramApprover.requested.title,
          message: buildNonTelegramApproverRequestedNotificationContent({
            requestSetId: approvalContext.requestSetId,
            approverName: approver.name,
            approverTitle: approver.title,
          }),
          logContext: {
            operationId,
            requestSetId: approvalContext.requestSetId,
            approverName: approver.name,
            phase: "requested",
          },
        })

        currentNonTelegramApproverNotificationId = notification.notificationId
      }

      log.info("waiting for approver operation result", {
        operationId,
        approverOperationId,
        approverName: approver.name,
      })

      const approvalResponse = await waitForOperationResult<ApprovalResponseJson>(
        approverOperationId,
        async (waitOperationId, workflowId) => {
          return await subscribeToExternalOperationCompletion({
            approverId: approver.id,
            operationId: waitOperationId,
            workflowId,
          })
        },
      )

      currentApproverOperation = undefined

      if (approvalResponse.result === "ESCALATED") {
        log.info("approver escalated request", { operationId, approverName: approver.name })

        const nextApprover = approvers[approverIndex + 1]
        if (
          currentNonTelegramApproverNotificationId !== undefined &&
          nextApprover !== undefined &&
          isTelegramApproverName(nextApprover.name)
        ) {
          await deleteNotificationSafely(currentNonTelegramApproverNotificationId, {
            operationId,
            requestSetId: approvalContext.requestSetId,
            approverName: approver.name,
            phase: "escalated-to-telegram",
          })

          currentNonTelegramApproverNotificationId = undefined
        }

        previousEscalation = {
          approverTitle:
            approver.title.trim().length > 0
              ? approver.title.trim()
              : strings.workflow.previousEscalation.fallbackApproverTitle,
          resolution: approvalResponse.resolution ?? "",
        }
        continue
      }

      if (approvalResponse.result === "APPROVED") {
        log.info("approver approved request", { operationId, approverName: approver.name })

        if (currentNonTelegramApproverNotificationId !== undefined) {
          await updateNotificationSafely({
            notificationId: currentNonTelegramApproverNotificationId,
            title: strings.notifications.nonTelegramApprover.approved.title,
            message: buildNonTelegramApproverResolvedNotificationContent({
              requestSetId: approvalContext.requestSetId,
              approverName: approver.name,
              approverTitle: approver.title,
              result: "APPROVED",
              resolution: approvalResponse.resolution ?? "",
            }),
            logContext: {
              operationId,
              requestSetId: approvalContext.requestSetId,
              approverName: approver.name,
              phase: "approved",
            },
          })

          currentNonTelegramApproverNotificationId = undefined
        }

        await approvePermissionRequestSet({
          operationId,
          resolution: approvalResponse.resolution ?? "",
          resolvedBySubjectId: null,
        })

        if (!isTelegramApproverName(approver.name)) {
          await sendSystemNotificationSafely({
            title: strings.notifications.approvedRequest.title,
            message: buildApprovedNotificationContent({
              requestSetId: approvalContext.requestSetId,
              approverName: approver.name,
              approverTitle: approver.title,
              resolution: approvalResponse.resolution ?? "",
            }),
            logContext: {
              operationId,
              requestSetId: approvalContext.requestSetId,
              approverName: approver.name,
              phase: "approved-summary",
            },
          })
        }

        log.info("processed approved request notification", {
          operationId,
          requestSetId: approvalContext.requestSetId,
          approverName: approver.name,
        })
        return
      }

      log.info("approver rejected request", { operationId, approverName: approver.name })

      if (currentNonTelegramApproverNotificationId !== undefined) {
        await updateNotificationSafely({
          notificationId: currentNonTelegramApproverNotificationId,
          title: strings.notifications.nonTelegramApprover.rejected.title,
          message: buildNonTelegramApproverResolvedNotificationContent({
            requestSetId: approvalContext.requestSetId,
            approverName: approver.name,
            approverTitle: approver.title,
            result: "REJECTED",
            resolution: approvalResponse.resolution ?? "",
          }),
          logContext: {
            operationId,
            requestSetId: approvalContext.requestSetId,
            approverName: approver.name,
            phase: "rejected",
          },
        })

        currentNonTelegramApproverNotificationId = undefined
      }

      await rejectPermissionRequestSet({
        operationId,
        resolution: approvalResponse.resolution ?? "",
        resolvedBySubjectId: null,
      })
      return
    }

    log.info("no approver approved request, marking as rejected")

    await rejectPermissionRequestSet({
      operationId,
      resolution: strings.common.noApproverApproved,
      resolvedBySubjectId: null,
    })
  } catch (error) {
    if (isCancellation(error)) {
      log.info("approval workflow cancelled", { operationId })

      if (currentApproverOperation !== undefined) {
        log.info("cancelling active approver operation", {
          operationId,
          approverId: currentApproverOperation.approverId,
          approverOperationId: currentApproverOperation.operationId,
        })
        await cancelApproverOperation(currentApproverOperation)
      }

      if (currentNonTelegramApproverNotificationId !== undefined) {
        await deleteNotificationSafely(currentNonTelegramApproverNotificationId, {
          operationId,
          phase: "workflow-cancelled",
        })
      }

      return
    }

    log.error("approval workflow failed, marking operation as failed", { operationId })

    await failPermissionRequestSetWorkflowIfPending({
      operationId,
      resolution: strings.common.approvalWorkflowFailed,
    })

    log.info("marked approval operation as failed", { operationId })

    return
  }
}

const TELEGRAM_APPROVAL_CHANNEL = "telegram:approval"

function isTelegramApproverName(approverName: string): boolean {
  return approverName.trim().toLowerCase() === "telegram"
}

function buildApprovedNotificationContent(args: {
  requestSetId: number
  approverName: string
  approverTitle: string
  resolution: string
}): string {
  const normalizedApproverTitle = args.approverTitle.trim()
  const normalizedResolution = args.resolution.trim()

  return block(
    inline(
      bold(strings.notifications.approvedRequest.requestSetLabel),
      SPACE,
      String(args.requestSetId),
    ),
    inline(
      bold(strings.notifications.approvedRequest.approverLabel),
      SPACE,
      normalizedApproverTitle.length > 0 ? normalizedApproverTitle : args.approverName,
    ),
    bold(strings.notifications.approvedRequest.resolutionLabel),
    normalizedResolution.length > 0
      ? normalizedResolution
      : strings.notifications.approvedRequest.emptyResolution,
  ).html
}

function buildNonTelegramApproverRequestedNotificationContent(args: {
  requestSetId: number
  approverName: string
  approverTitle: string
}): string {
  const normalizedApproverTitle = args.approverTitle.trim()

  return block(
    inline(
      bold(strings.notifications.nonTelegramApprover.requested.requestSetLabel),
      SPACE,
      String(args.requestSetId),
    ),
    inline(
      bold(strings.notifications.nonTelegramApprover.requested.approverLabel),
      SPACE,
      normalizedApproverTitle.length > 0 ? normalizedApproverTitle : args.approverName,
    ),
    inline(
      bold(strings.notifications.nonTelegramApprover.requested.statusLabel),
      SPACE,
      strings.notifications.nonTelegramApprover.requested.statusValue,
    ),
  ).html
}

function buildNonTelegramApproverResolvedNotificationContent(args: {
  requestSetId: number
  approverName: string
  approverTitle: string
  result: "APPROVED" | "REJECTED"
  resolution: string
}): string {
  const normalizedApproverTitle = args.approverTitle.trim()
  const normalizedResolution = args.resolution.trim()
  const resolvedStrings =
    args.result === "APPROVED"
      ? strings.notifications.nonTelegramApprover.approved
      : strings.notifications.nonTelegramApprover.rejected

  return block(
    inline(bold(resolvedStrings.requestSetLabel), SPACE, String(args.requestSetId)),
    inline(
      bold(resolvedStrings.approverLabel),
      SPACE,
      normalizedApproverTitle.length > 0 ? normalizedApproverTitle : args.approverName,
    ),
    inline(bold(resolvedStrings.statusLabel), SPACE, resolvedStrings.statusValue),
    bold(resolvedStrings.resolutionLabel),
    normalizedResolution.length > 0 ? normalizedResolution : resolvedStrings.emptyResolution,
  ).html
}

async function sendSystemNotificationSafely(args: {
  title: string
  message: string
  logContext: Record<string, number | string>
}): Promise<{ notificationId?: string }> {
  try {
    const notification = await sendNotification({
      system: true,
      channel: TELEGRAM_APPROVAL_CHANNEL,
      title: args.title,
      message: {
        html: args.message,
      },
    })

    return {
      notificationId: notification.notificationId,
    }
  } catch (error) {
    log.error("failed to send notification", {
      ...args.logContext,
      error: String(error),
    })

    return {}
  }
}

async function updateNotificationSafely(args: {
  notificationId: string
  title: string
  message: string
  logContext: Record<string, number | string>
}): Promise<void> {
  try {
    await updateNotification({
      notificationId: args.notificationId,
      title: args.title,
      content: {
        html: args.message,
      },
    })
  } catch (error) {
    log.error("failed to update notification", {
      ...args.logContext,
      notificationId: args.notificationId,
      error: String(error),
    })
  }
}

async function deleteNotificationSafely(
  notificationId: string,
  logContext: Record<string, number | string>,
): Promise<void> {
  try {
    await deleteNotification(notificationId)
  } catch (error) {
    log.error("failed to delete notification", {
      ...logContext,
      notificationId,
      error: String(error),
    })
  }
}

function buildApproverDecisionContent(args: BuildApproverDecisionContentArgs): string {
  if (args.previousEscalation === undefined) {
    return args.baseContent
  }

  const resolution = args.previousEscalation.resolution.trim()

  return block(
    { html: args.baseContent },
    "",
    bold(strings.workflow.previousEscalation.header),
    inline(
      bold(strings.workflow.previousEscalation.approverTitleLabel),
      SPACE,
      args.previousEscalation.approverTitle,
    ),
    bold(strings.workflow.previousEscalation.resolutionLabel),
    resolution.length > 0 ? resolution : strings.workflow.previousEscalation.emptyResolution,
  ).html
}
