import type { ApprovalResponseJson } from "@reside/api/common/approval.v1"
import type { AccessActivities, ApprovePermissionRequestSetWorkflowInput } from "../definitions"
import {
  block,
  bold,
  inline,
  SPACE,
  sendNotification,
  updateNotification,
  waitForOperationResult,
} from "@reside/common/workflow"
import { isCancellation, log, proxyActivities } from "@temporalio/workflow"
import { AccessNotificationChannels } from "../definitions"
import { strings } from "../locale"

const {
  getApprovalContext,
  subscribeToExternalOperationCompletion,
  cancelApproverOperation,
  approvePermissionRequestSet,
  rejectPermissionRequestSet,
  failPermissionRequestSetWorkflowIfPending,
  canUseApprovalNotifications,
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

type ApprovalDecisionResult = "APPROVED" | "REJECTED" | "ESCALATED"

type ApprovalDecision = {
  approverName: string
  approverTitle: string
  result: ApprovalDecisionResult
  resolution?: string
}

type CurrentApproverOperation = {
  approverId: number
  operationId: number
}

type BuildApproverDecisionContentArgs = {
  baseContent: string
  decisions: ApprovalDecision[]
}

export async function approvePermissionRequestSetWorkflow({
  operationId,
}: ApprovePermissionRequestSetWorkflowInput): Promise<void> {
  log.info("starting approvePermissionRequestSetWorkflow", { operationId })

  const decisions: ApprovalDecision[] = []
  let currentApproverOperation: CurrentApproverOperation | undefined
  let notificationId: string | undefined

  try {
    const approvalContext = await getApprovalContext({ operationId })
    const approvers = approvalContext.approvers

    log.info("loaded approval context", { operationId, approversCount: approvers.length })

    const approvalNotifications = await canUseApprovalNotifications()

    for (const approver of approvers) {
      log.info("requesting approver decision", { operationId, approverName: approver.name })

      const waitingTitle = strings.notifications.permissionRequests.waitingApprover.title
      const waitingMessage = buildApprovalProcessNotificationContent({
        baseContent: approvalContext.content,
        decisions,
        status: strings.notifications.permissionRequests.waitingApprover.status(
          resolveApproverTitle(approver),
        ),
      })

      if (notificationId === undefined && approvalNotifications.available) {
        const notification = await sendApprovalProcessNotification({
          title: waitingTitle,
          message: waitingMessage,
          logContext: {
            operationId,
            requestSetId: approvalContext.requestSetId,
            approverName: approver.name,
            phase: "waiting-first-approver",
          },
        })

        notificationId = notification.notificationId
      } else {
        await updateApprovalProcessNotificationSafely({
          notificationId,
          title: waitingTitle,
          message: waitingMessage,
          logContext: {
            operationId,
            requestSetId: approvalContext.requestSetId,
            approverName: approver.name,
            phase: "waiting-approver",
          },
        })
      }

      const { operationId: approverOperationId } = await requestApproverDecision({
        approverId: approver.id,
        title: approvalContext.title,
        content: buildApproverDecisionContent({
          baseContent: approvalContext.content,
          decisions,
        }),
      })

      currentApproverOperation = {
        approverId: approver.id,
        operationId: approverOperationId,
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

      if (approvalResponse.result === undefined) {
        throw new Error(`Approver operation "${approverOperationId}" completed without result`)
      }

      decisions.push({
        approverName: approver.name,
        approverTitle: resolveApproverTitle(approver),
        result: approvalResponse.result,
        resolution: approvalResponse.resolution ?? "",
      })

      if (approvalResponse.result === "ESCALATED") {
        log.info("approver escalated request", { operationId, approverName: approver.name })

        await updateApprovalProcessNotificationSafely({
          notificationId,
          title: strings.notifications.permissionRequests.escalated.title,
          message: buildApprovalProcessNotificationContent({
            baseContent: approvalContext.content,
            decisions,
            status: strings.notifications.permissionRequests.escalated.status,
          }),
          logContext: {
            operationId,
            requestSetId: approvalContext.requestSetId,
            approverName: approver.name,
            phase: "escalated",
          },
        })
        continue
      }

      if (approvalResponse.result === "APPROVED") {
        log.info("approver approved request", { operationId, approverName: approver.name })

        await approvePermissionRequestSet({
          operationId,
          resolution: approvalResponse.resolution ?? "",
          resolvedBySubjectId: null,
        })

        await updateApprovalProcessNotificationSafely({
          notificationId,
          title: strings.notifications.permissionRequests.approved.title,
          message: buildApprovalProcessNotificationContent({
            baseContent: approvalContext.content,
            decisions,
            status: strings.notifications.permissionRequests.approved.status,
          }),
          actions: {},
          logContext: {
            operationId,
            requestSetId: approvalContext.requestSetId,
            approverName: approver.name,
            phase: "approved",
          },
        })

        log.info("processed approved request notification", {
          operationId,
          requestSetId: approvalContext.requestSetId,
          approverName: approver.name,
        })
        return
      }

      log.info("approver rejected request", { operationId, approverName: approver.name })

      await rejectPermissionRequestSet({
        operationId,
        resolution: approvalResponse.resolution ?? "",
        resolvedBySubjectId: null,
      })

      await updateApprovalProcessNotificationSafely({
        notificationId,
        title: strings.notifications.permissionRequests.rejected.title,
        message: buildApprovalProcessNotificationContent({
          baseContent: approvalContext.content,
          decisions,
          status: strings.notifications.permissionRequests.rejected.status,
        }),
        actions: {},
        logContext: {
          operationId,
          requestSetId: approvalContext.requestSetId,
          approverName: approver.name,
          phase: "rejected",
        },
      })
      return
    }

    if (notificationId === undefined) {
      log.info("approval notification unavailable, marking as rejected")

      await rejectPermissionRequestSet({
        operationId,
        resolution: strings.common.noApproverApproved,
        resolvedBySubjectId: null,
      })

      return
    }

    log.info("requesting final human approval", { operationId })

    const finalDecision = await updateNotification({
      notificationId,
      title: strings.notifications.permissionRequests.humanApproval.title,
      content: {
        html: buildApprovalProcessNotificationContent({
          baseContent: approvalContext.content,
          decisions,
          status: strings.notifications.permissionRequests.humanApproval.status,
        }),
      },
      actions: {
        approve: {
          title: strings.notifications.permissionRequests.humanApproval.actions.approve,
        },
        reject: {
          title: strings.notifications.permissionRequests.humanApproval.actions.reject,
        },
      },
      requiresTextResponse: false,
      expectImmediateFeedback: true,
    })

    if (finalDecision.type !== "action") {
      throw new Error(`Unexpected approval notification response type: ${finalDecision.type}`)
    }

    if (finalDecision.actionName === "approve") {
      const humanApproverTitle =
        finalDecision.subjectId ??
        strings.notifications.permissionRequests.humanApproval.approverTitle

      decisions.push({
        approverName: strings.notifications.permissionRequests.humanApproval.approverName,
        approverTitle: humanApproverTitle,
        result: "APPROVED",
      })

      await approvePermissionRequestSet({
        operationId,
        resolution: strings.notifications.permissionRequests.humanApproval.approvedResolution,
        resolvedBySubjectId: finalDecision.subjectId ?? null,
      })

      await updateApprovalProcessNotificationSafely({
        notificationId,
        title: strings.notifications.permissionRequests.approved.title,
        message: buildApprovalProcessNotificationContent({
          baseContent: approvalContext.content,
          decisions,
          status: strings.notifications.permissionRequests.approved.status,
        }),
        actions: {},
        logContext: {
          operationId,
          requestSetId: approvalContext.requestSetId,
          phase: "human-approved",
        },
      })

      return
    }

    const humanApproverTitle =
      finalDecision.subjectId ??
      strings.notifications.permissionRequests.humanApproval.approverTitle

    decisions.push({
      approverName: strings.notifications.permissionRequests.humanApproval.approverName,
      approverTitle: humanApproverTitle,
      result: "REJECTED",
    })

    await rejectPermissionRequestSet({
      operationId,
      resolution: strings.notifications.permissionRequests.humanApproval.rejectedResolution,
      resolvedBySubjectId: finalDecision.subjectId ?? null,
    })

    await updateApprovalProcessNotificationSafely({
      notificationId,
      title: strings.notifications.permissionRequests.rejected.title,
      message: buildApprovalProcessNotificationContent({
        baseContent: approvalContext.content,
        decisions,
        status: strings.notifications.permissionRequests.rejected.status,
      }),
      actions: {},
      logContext: {
        operationId,
        requestSetId: approvalContext.requestSetId,
        phase: "human-rejected",
      },
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

async function sendApprovalProcessNotification(args: {
  title: string
  message: string
  logContext: Record<string, number | string>
}): Promise<{ notificationId?: string }> {
  try {
    const notification = await sendNotification({
      system: true,
      channel: AccessNotificationChannels.PERMISSION_REQUESTS,
      title: args.title,
      message: {
        html: args.message,
      },
      waitForResponse: false,
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

async function updateApprovalProcessNotificationSafely(args: {
  notificationId: string | undefined
  title: string
  message: string
  actions?: Record<string, never>
  logContext: Record<string, number | string>
}): Promise<void> {
  if (args.notificationId === undefined) {
    return
  }

  try {
    await updateNotification({
      notificationId: args.notificationId,
      title: args.title,
      content: {
        html: args.message,
      },
      actions: args.actions,
      requiresTextResponse: false,
    })
  } catch (error) {
    log.error("failed to update notification", {
      ...args.logContext,
      notificationId: args.notificationId,
      error: String(error),
    })
  }
}

function buildApproverDecisionContent(args: BuildApproverDecisionContentArgs): string {
  if (args.decisions.length === 0) {
    return args.baseContent
  }

  return block({ html: args.baseContent }, "", buildApprovalHistoryContent(args.decisions)).html
}

function buildApprovalProcessNotificationContent(args: {
  baseContent: string
  decisions: ApprovalDecision[]
  status: string
}): string {
  const content = block(
    { html: args.baseContent },
    "",
    inline(bold(strings.notifications.permissionRequests.statusLabel), SPACE, args.status),
  )

  if (args.decisions.length === 0) {
    return content.html
  }

  return block(content, "", buildApprovalHistoryContent(args.decisions)).html
}

function buildApprovalHistoryContent(decisions: ApprovalDecision[]) {
  return block(
    bold(strings.notifications.permissionRequests.historyHeader),
    "",
    decisions.map(decision => buildApprovalDecisionContent(decision)),
  )
}

function buildApprovalDecisionContent(decision: ApprovalDecision) {
  const resolution = decision.resolution?.trim()

  if (resolution === undefined) {
    return block(
      inline(
        bold(strings.notifications.permissionRequests.approverLabel),
        SPACE,
        decision.approverTitle,
      ),
      inline(
        bold(strings.notifications.permissionRequests.decisionLabel),
        SPACE,
        toApprovalDecisionResultText(decision.result),
      ),
    )
  }

  return block(
    inline(
      bold(strings.notifications.permissionRequests.approverLabel),
      SPACE,
      decision.approverTitle,
    ),
    inline(
      bold(strings.notifications.permissionRequests.decisionLabel),
      SPACE,
      toApprovalDecisionResultText(decision.result),
    ),
    inline(bold(strings.notifications.permissionRequests.resolutionLabel)),
    resolution.length > 0 ? resolution : strings.notifications.permissionRequests.emptyResolution,
  )
}

function resolveApproverTitle(approver: { name: string; title: string }): string {
  const title = approver.title.trim()
  if (title.length > 0) {
    return title
  }

  return approver.name
}

function toApprovalDecisionResultText(result: ApprovalDecisionResult): string {
  switch (result) {
    case "APPROVED":
      return strings.notifications.permissionRequests.decisions.approved
    case "REJECTED":
      return strings.notifications.permissionRequests.decisions.rejected
    case "ESCALATED":
      return strings.notifications.permissionRequests.decisions.escalated
  }
}
