import type { OperationServiceClient } from "@reside/api/common/operation.v1"
import type {
  NotificationResponse,
  NotificationServiceClient,
} from "@reside/api/interaction/notification.v1"
import type { Operation, PrismaClient } from "../database"
import { createInteractionActivities, type GenericOperationService } from "@reside/common"
import { strings } from "../locale"

type TelegramOperationService = GenericOperationService<Operation>

export function createTelegramActivities(args: {
  prisma: PrismaClient
  notificationService: NotificationServiceClient
  operationService: OperationServiceClient
  localOperationService: TelegramOperationService
}) {
  return {
    ...createInteractionActivities({
      notificationService: args.notificationService,
      operationService: args.operationService,
    }),

    async completeApprovalOperation(input: {
      operationId: number
      notificationResponse: NotificationResponse
    }): Promise<void> {
      const response = input.notificationResponse.response
      if (!response || response.$case !== "actionName") {
        throw new Error("Approval notification response must be actionName")
      }

      const mappedResult = mapActionToResult(response.value)

      await args.prisma.$transaction(async tx => {
        await tx.approvalRequest.update({
          where: {
            operationId: input.operationId,
          },
          data: {
            result: mappedResult.result,
            resolution: mappedResult.resolution,
            respondedAt: new Date(),
          },
        })
      })

      await args.localOperationService.setCompleted(input.operationId)
    },

    async failApprovalOperation(input: {
      operationId: number
      reason: string
      message: string
    }): Promise<void> {
      await args.prisma.operation.update({
        where: {
          id: input.operationId,
        },
        data: {
          status: "FAILED",
          failureReason: input.reason,
          failureMessage: input.message,
          resolvedAt: new Date(),
        },
      })
    },
  }
}

function mapActionToResult(actionName: string): {
  result: "ESCALATED" | "APPROVED" | "REJECTED"
  resolution: string
} {
  switch (actionName) {
    case "approve":
      return {
        result: "APPROVED",
        resolution: strings.worker.activities.approvalResolutionApproved,
      }
    case "reject":
      return {
        result: "REJECTED",
        resolution: strings.worker.activities.approvalResolutionRejected,
      }
    case "escalate":
      return {
        result: "ESCALATED",
        resolution: strings.worker.activities.approvalResolutionEscalated,
      }
    default:
      throw new Error(`Unknown approval action: ${actionName}`)
  }
}
