import { status as grpcStatus } from "@grpc/grpc-js"
import { AuthzServiceDefinition } from "@reside/api/access/authz.v1"
import { DefinitionServiceDefinition as AccessDefinitionServiceDefinition } from "@reside/api/access/definition.v1"
import { PermissionRequestServiceDefinition } from "@reside/api/access/request.v1"
import { ApprovalResponse, ApprovalResult } from "@reside/api/common/approval.v1"
import { OperationServiceDefinition } from "@reside/api/common/operation.v1"
import { SubjectServiceDefinition } from "@reside/api/common/subject.v1"
import { ProvisionServiceDefinition } from "@reside/api/database/provision.v1"
import { DefinitionServiceDefinition as InteractionDefinitionServiceDefinition } from "@reside/api/interaction/definition.v1"
import {
  NotificationResponse,
  NotificationServiceDefinition,
} from "@reside/api/interaction/notification.v1"
import {
  createChannels,
  createClient,
  createGenericOperationService,
  createPostgresPool,
  createTemporalClient,
} from "@reside/common"
import { telegramReplica } from "@reside/topology"
import { isGrpcServiceError } from "@temporalio/client"
import { PrismaClient } from "../database"
import { getTelegramApprovalWorkflowId, TELEGRAM_APPROVAL_CANCEL_SIGNAL } from "../definitions"

export async function createServices() {
  const channels = await createChannels(telegramReplica.endpoints)

  const databaseProvisionService = createClient(ProvisionServiceDefinition, channels.database)
  const databaseOperationService = createClient(OperationServiceDefinition, channels.database)

  const accessRequestService = createClient(PermissionRequestServiceDefinition, channels.access)
  const accessOperationService = createClient(OperationServiceDefinition, channels.access)
  const accessDefinitionService = createClient(AccessDefinitionServiceDefinition, channels.access)
  const accessAuthzService = createClient(AuthzServiceDefinition, channels.access)
  const accessSubjectService = createClient(SubjectServiceDefinition, channels.access)
  const interactionDefinitionService = createClient(
    InteractionDefinitionServiceDefinition,
    channels.self,
  )
  const interactionNotificationService = createClient(NotificationServiceDefinition, channels.self)
  const interactionOperationService = createClient(OperationServiceDefinition, channels.self)

  const { pool, adapter } = await createPostgresPool({
    provisionService: databaseProvisionService,
    operationService: databaseOperationService,
  })

  const prisma = new PrismaClient({ adapter })
  const temporalClient = await createTemporalClient({
    provisionService: databaseProvisionService,
    operationService: databaseOperationService,
  })

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
        return ApprovalResponse.create({
          result: toApprovalResult(approvalRequest.result),
          resolution: approvalRequest.resolution ?? "",
        })
      }

      const response = await prisma.notificationResponse.findUnique({
        where: {
          operationId,
        },
      })

      if (response === null) {
        throw new Error(`Operation "${operationId}" has no notification response result`)
      }

      if (response.type === "ACTION") {
        if (!response.actionName) {
          throw new Error(`Operation "${operationId}" ACTION response has no actionName`)
        }

        return NotificationResponse.create({
          response: {
            $case: "actionName",
            value: response.actionName,
          },
        })
      }

      if (!response.textResponse) {
        throw new Error(`Operation "${operationId}" TEXT response has no textResponse`)
      }

      return NotificationResponse.create({
        response: {
          $case: "textResponse",
          value: response.textResponse,
        },
      })
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
        if (isGrpcServiceError(error) && error.code === grpcStatus.NOT_FOUND) {
          return
        }

        throw error
      }
    },
  })

  return {
    pool,
    prisma,
    operationService,
    temporalClient,
    databaseProvisionService,
    databaseOperationService,
    interactionDefinitionService,
    interactionNotificationService,
    interactionOperationService,
    accessRequestService,
    accessAuthzService,
    accessSubjectService,
    accessDefinitionService,
    accessOperationService,
  }
}

function toApprovalResult(result: "ESCALATED" | "APPROVED" | "REJECTED"): ApprovalResult {
  switch (result) {
    case "ESCALATED":
      return ApprovalResult.ESCALATED
    case "APPROVED":
      return ApprovalResult.APPROVED
    case "REJECTED":
      return ApprovalResult.REJECTED
  }
}
