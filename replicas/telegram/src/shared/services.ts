import type { ApprovalResponseJson } from "@reside/api/common/approval.v1"
import type {
  NotificationJson,
  NotificationStatusJson,
  NotificationTaskStatusJson,
} from "@reside/api/interaction/notification.v1"
import type {
  NotificationStatus as StoredNotificationStatus,
  NotificationTaskStatus as StoredNotificationTaskStatus,
} from "../database"
import { status as GrpcStatus } from "@grpc/grpc-js"
import { OperationService } from "@reside/api/common/operation.v1"
import { SubjectService } from "@reside/api/common/subject.v1"
import { DefinitionService as InteractionDefinitionService } from "@reside/api/interaction/definition.v1"
import { NotificationService } from "@reside/api/interaction/notification.v1"
import { TopicService } from "@reside/api/interaction/topic.v1"
import {
  createClient,
  createCommonServices,
  createGenericOperationService,
  createPostgresPool,
  createTemporalClient,
  crypto,
} from "@reside/common"
import { telegramReplica } from "@reside/registry"
import { isGrpcServiceError } from "@temporalio/client"
import { PrismaClient } from "../database"
import { approvalCancelSignal, encryptedStringSchema, getApprovalWorkflowId } from "../definitions"

export async function createServices() {
  const services = await createCommonServices(telegramReplica.endpoints)

  const subjectService = createClient(SubjectService, services.channels.access)
  const interactionDefinitionService = createClient(
    InteractionDefinitionService,
    services.channels.self,
  )
  const notificationService = createClient(NotificationService, services.channels.self)
  const topicService = createClient(TopicService, services.channels.self)
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
          notificationResponseContextToken: true,
          notificationResponse: true,
          notification: {
            select: notificationReadModelSelect,
          },
        },
      })

      if (operation === null) {
        throw new Error(`Operation "${operationId}" is not found`)
      }

      const response = operation.notificationResponse
      if (response === null) {
        return {}
      }

      const contextToken = operation.notificationResponseContextToken ?? undefined
      const notification =
        operation.notification === null ? undefined : toNotificationJson(operation.notification)

      if (response.type === "ACTION") {
        if (!response.actionName) {
          throw new Error(`Operation "${operationId}" ACTION response has no actionName`)
        }

        return {
          actionName: response.actionName,
          contextToken,
          notification,
        }
      }

      if (response.type === "TASK_UPDATE") {
        return {
          taskUpdate: {},
          contextToken,
          notification,
        }
      }

      if (!response.textResponseEcid) {
        throw new Error(`Operation "${operationId}" TEXT response has no textResponse`)
      }

      return {
        textResponse: await crypto.decrypt(encryptedStringSchema, response.textResponseEcid),
        contextToken,
        notification,
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
        const workflowHandle = temporalClient.workflow.getHandle(getApprovalWorkflowId(operationId))

        await workflowHandle.signal(approvalCancelSignal)
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
    topicService,
    interactionOperationService,
    subjectService,
  }
}

const notificationReadModelSelect = {
  id: true,
  title: true,
  content: true,
  status: true,
  actionRows: true,
  requiresTextResponse: true,
  isProtected: true,
  expectImmediateFeedback: true,
  acquireTopic: true,
  taskGroups: {
    orderBy: {
      position: "asc" as const,
    },
    select: {
      stableId: true,
      title: true,
      tasks: {
        orderBy: {
          position: "asc" as const,
        },
        select: {
          stableId: true,
          title: true,
          status: true,
        },
      },
    },
  },
}

function toNotificationJson(notification: {
  id: number
  title: string
  content: string
  status: StoredNotificationStatus
  actionRows: NotificationJson["actionRows"]
  requiresTextResponse: boolean
  isProtected: boolean
  expectImmediateFeedback: boolean
  acquireTopic: boolean
  taskGroups: {
    stableId: string
    title: string
    tasks: {
      stableId: string
      title: string
      status: StoredNotificationTaskStatus
    }[]
  }[]
}): NotificationJson {
  return {
    notificationId: String(notification.id),
    title: notification.title,
    content: notification.content,
    status: toNotificationStatusJson(notification.status),
    actionRows: notification.actionRows,
    taskGroups: notification.taskGroups.map(group => ({
      id: group.stableId,
      title: group.title,
      tasks: group.tasks.map(task => ({
        id: task.stableId,
        title: task.title,
        status: toNotificationTaskStatusJson(task.status),
      })),
    })),
    requiresTextResponse: notification.requiresTextResponse,
    protected: notification.isProtected,
    expectImmediateFeedback: notification.expectImmediateFeedback,
    acquireTopic: notification.acquireTopic,
  }
}

function toNotificationStatusJson(status: StoredNotificationStatus): NotificationStatusJson {
  switch (status) {
    case "PLANNING":
      return "NOTIFICATION_STATUS_PLANNING"
    case "IN_PROGRESS":
      return "NOTIFICATION_STATUS_IN_PROGRESS"
    case "COMPLETED":
      return "NOTIFICATION_STATUS_COMPLETED"
    case "FAILED":
      return "NOTIFICATION_STATUS_FAILED"
    case "REGULAR":
      return "NOTIFICATION_STATUS_REGULAR"
  }
}

function toNotificationTaskStatusJson(
  status: StoredNotificationTaskStatus,
): NotificationTaskStatusJson {
  switch (status) {
    case "PENDING":
      return "NOTIFICATION_TASK_STATUS_PENDING"
    case "IN_PROGRESS":
      return "NOTIFICATION_TASK_STATUS_IN_PROGRESS"
    case "COMPLETED":
      return "NOTIFICATION_TASK_STATUS_COMPLETED"
    case "FAILED":
      return "NOTIFICATION_TASK_STATUS_FAILED"
    case "SKIPPED":
      return "NOTIFICATION_TASK_STATUS_SKIPPED"
    case "PLANNED":
      return "NOTIFICATION_TASK_STATUS_PLANNED"
  }
}
