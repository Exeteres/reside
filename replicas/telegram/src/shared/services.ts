import type { ApprovalResponseJson } from "@reside/api/common/approval.v1"
import { status as GrpcStatus } from "@grpc/grpc-js"
import { OperationService } from "@reside/api/common/operation.v1"
import { SubjectService } from "@reside/api/common/subject.v1"
import { DefinitionService as InteractionDefinitionService } from "@reside/api/interaction/definition.v1"
import { NotificationService } from "@reside/api/interaction/notification.v1"
import {
  createClient,
  createCommonServices,
  createGenericOperationService,
  createPostgresPool,
  createTemporalClient,
} from "@reside/common"
import { telegramReplica } from "@reside/registry"
import { isGrpcServiceError } from "@temporalio/client"
import { PrismaClient } from "../database"
import { getTelegramApprovalWorkflowId, TELEGRAM_APPROVAL_CANCEL_SIGNAL } from "../definitions"

export async function createServices() {
  const services = await createCommonServices(telegramReplica.endpoints)

  const subjectService = createClient(SubjectService, services.channels.access)
  const interactionDefinitionService = createClient(
    InteractionDefinitionService,
    services.channels.self,
  )
  const notificationService = createClient(NotificationService, services.channels.self)
  const interactionOperationService = createClient(OperationService, services.channels.self)

  const { pool, adapter } = await createPostgresPool(services)

  const prisma = new PrismaClient({ adapter })
  const temporalClient = await createTemporalClient(services)

  const operationService = createGenericOperationService({
    prisma,
    temporalClient,

    getResult: async operationId => {
      const approvalRequest = await prisma.approvalRequest.findUnique({
        where: {
          operationId,
        },
      })

      if (approvalRequest?.result !== null && approvalRequest?.result !== undefined) {
        return {
          result: approvalRequest.result,
          resolution: approvalRequest.resolution ?? "",
        } satisfies ApprovalResponseJson
      }

      const avatarProvisionRequest = await prisma.avatarProvisionRequest.findUnique({
        where: {
          operationId,
        },
      })

      if (avatarProvisionRequest) {
        return {}
      }

      const operation = await prisma.operation.findUnique({
        where: {
          id: operationId,
        },
        select: {
          customData: true,
          notificationResponse: true,
        },
      })

      if (operation === null) {
        throw new Error(`Operation "${operationId}" is not found`)
      }

      const response = operation.notificationResponse
      if (response === null) {
        throw new Error(`Operation "${operationId}" has no notification response result`)
      }

      const contextToken = readNotificationResponseContextToken(operation.customData)

      if (response.type === "ACTION") {
        if (!response.actionName) {
          throw new Error(`Operation "${operationId}" ACTION response has no actionName`)
        }

        return {
          actionName: response.actionName,
          contextToken,
        }
      }

      if (!response.textResponse) {
        throw new Error(`Operation "${operationId}" TEXT response has no textResponse`)
      }

      return {
        textResponse: response.textResponse,
        contextToken,
      }
    },

    cancelOperation: async operationId => {
      const approvalRequest = await prisma.approvalRequest.findUnique({
        where: {
          operationId,
        },
        select: {
          operationId: true,
        },
      })

      if (approvalRequest === null) {
        return
      }

      try {
        const workflowHandle = temporalClient.workflow.getHandle(
          getTelegramApprovalWorkflowId(operationId),
        )

        await workflowHandle.signal(TELEGRAM_APPROVAL_CANCEL_SIGNAL)
      } catch (error) {
        if (isGrpcServiceError(error) && error.code === GrpcStatus.NOT_FOUND) {
          return
        }

        throw error
      }
    },
  })

  return {
    ...services,
    pool,
    prisma,
    operationService,
    temporalClient,
    interactionDefinitionService,
    notificationService,
    interactionOperationService,
    subjectService,
  }
}

function readNotificationResponseContextToken(customData: unknown): string | undefined {
  if (typeof customData !== "object" || customData === null) {
    return undefined
  }

  if (!("notificationResponseContextToken" in customData)) {
    return undefined
  }

  const value = (customData as { notificationResponseContextToken?: unknown })
    .notificationResponseContextToken
  return typeof value === "string" && value.length > 0 ? value : undefined
}
