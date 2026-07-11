import type {
  Notification as ApiNotification,
  NotificationJson,
  NotificationServiceImplementation,
} from "@reside/api/interaction/notification.v1"
import type { ResideCrypto } from "@reside/common/encryption"
import type { Operation, PrismaClient } from "../../database"
import type {
  NotificationStatus,
  NotificationTaskGroupInput,
  NotificationTaskStatus,
} from "../business/notification-types"
import { fromJson } from "@bufbuild/protobuf"
import { Code, ConnectError } from "@connectrpc/connect"
import { CoreV1Api } from "@kubernetes/client-node"
import {
  NotificationStatus as ApiNotificationStatus,
  NotificationTaskStatus as ApiNotificationTaskStatus,
  NotificationSchema,
} from "@reside/api/interaction/notification.v1"
import {
  authenticateReplica,
  type CommonServices,
  type GenericOperationService,
  getReplicaNamespace,
  kubeConfig,
  logger,
} from "@reside/common"
import { createTelegramBotClient } from "../business/bot-client"
import {
  loadTelegramConfigState,
  TELEGRAM_CONFIG_MAP_NAME,
  TELEGRAM_SYSTEM_CHAT_ID_KEY,
} from "../business/config"
import {
  acceptNotificationResponseForReplica,
  assertActionRows,
  deleteNotificationForReplica,
  parseNotificationId,
  sendNotificationForReplica,
  updateNotificationForReplica,
} from "../business/notification"
import { loadTelegramSecretState, TELEGRAM_BOT_TOKEN_SECRET_KEY } from "../business/secret"

export function createNotificationService({
  prisma,
  authzService,
  subjectService,
  operationService,
  crypto,
}: CommonServices<"access"> & {
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
  crypto: ResideCrypto
}): NotificationServiceImplementation {
  const namespace = getReplicaNamespace()
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)

  async function loadDeliveryConfig(): Promise<{ botToken: string; systemChatId: string }> {
    const secretState = await loadTelegramSecretState(crypto)
    const configState = await loadTelegramConfigState(coreApi, namespace)

    if (!secretState.botToken) {
      throw new ConnectError(
        `Vault secret key "${TELEGRAM_BOT_TOKEN_SECRET_KEY}" must contain token value`,
        Code.FailedPrecondition,
      )
    }

    if (!configState.systemChatId) {
      throw new ConnectError(
        `ConfigMap "${TELEGRAM_CONFIG_MAP_NAME}" must contain "${TELEGRAM_SYSTEM_CHAT_ID_KEY}"`,
        Code.FailedPrecondition,
      )
    }

    return {
      botToken: secretState.botToken,
      systemChatId: configState.systemChatId,
    }
  }

  return {
    async sendNotification(request, context) {
      const { name: replicaName } = await authenticateReplica(context)

      logger.info(
        "sendNotification requested by replica %s for channel %s",
        replicaName,
        request.channel,
      )

      try {
        const result = await sendNotificationForReplica(
          crypto,
          prisma,
          authzService,
          subjectService,
          createTelegramBotClient,
          loadDeliveryConfig,
          replicaName,
          {
            channel: request.channel,
            title: request.title,
            content: request.content,
            actionRows: request.actionRows,
            images: request.images,
            attachments: request.attachments,
            contextToken: request.contextToken,
            sendAsSubjectId: request.sendAsSubjectId,
            requiresTextResponse: request.requiresTextResponse,
            protected: request.protected,
            protectedForSubjectId: request.protectedForSubjectId,
            expectImmediateFeedback: request.expectImmediateFeedback,
            topicId: request.topicId,
            acquireTopic: request.acquireTopic,
            acceptedDiceEmojis: request.acceptedDiceEmojis,
            status: toBusinessNotificationStatus(request.status),
            taskGroups: request.taskGroups.map(toBusinessTaskGroup),
          },
        )

        return {
          notificationId: result.notificationId,
          messageLink: result.messageLink,
          notification: toApiNotification(requireNotificationReadModel(result.notification)),
          operation:
            result.operationId === undefined
              ? undefined
              : await operationService.toApiOperation(result.operationId),
        }
      } catch (error) {
        throwNotificationServiceError(
          error,
          "failed to send telegram notification",
          "Failed to send telegram notification",
        )
      }
    },

    async updateNotification(request, context) {
      const { name: replicaName } = await authenticateReplica(context)

      logger.info(
        "updateNotification requested by replica %s for notificationId %s",
        replicaName,
        request.notificationId,
      )

      try {
        parseNotificationId(request.notificationId)
        assertActionRows(request.actionRows)

        const result = await updateNotificationForReplica(
          crypto,
          prisma,
          subjectService,
          createTelegramBotClient,
          loadDeliveryConfig,
          replicaName,
          {
            notificationId: request.notificationId,
            title: request.title,
            content: request.content,
            actionRows: request.actionRows,
            requiresTextResponse: request.requiresTextResponse,
            expectImmediateFeedback: request.expectImmediateFeedback,
            protectedForSubjectId: request.protectedForSubjectId,
            acceptedDiceEmojis: request.acceptedDiceEmojis,
            acquireTopic: request.acquireTopic,
            status: toBusinessNotificationStatus(request.status),
            taskGroups: request.taskGroups.map(toBusinessTaskGroup),
          },
        )

        return {
          notification: toApiNotification(requireNotificationReadModel(result.notification)),
          operation:
            result.operationId === undefined
              ? undefined
              : await operationService.toApiOperation(result.operationId),
        }
      } catch (error) {
        throwNotificationServiceError(
          error,
          "failed to update telegram notification",
          "Failed to update telegram notification",
        )
      }
    },

    async acceptNotificationResponse(request, context) {
      const { name: replicaName } = await authenticateReplica(context)

      logger.info(
        "acceptNotificationResponse requested by replica %s for notificationId %s",
        replicaName,
        request.notificationId,
      )

      try {
        parseNotificationId(request.notificationId)

        const result = await acceptNotificationResponseForReplica(
          crypto,
          prisma,
          createTelegramBotClient,
          loadDeliveryConfig,
          {
            notificationId: request.notificationId,
          },
        )

        return {
          notification: toApiNotification(requireNotificationReadModel(result.notification)),
          operation: await operationService.toApiOperation(result.operationId),
        }
      } catch (error) {
        if (error instanceof ConnectError) {
          throw error
        }

        logger.error({ error }, "failed to accept telegram notification response")
        throw new ConnectError("Failed to accept telegram notification response", Code.Internal)
      }
    },

    async deleteNotification(request, context) {
      const { name: replicaName } = await authenticateReplica(context)

      logger.info(
        "deleteNotification requested by replica %s for notificationId %s",
        replicaName,
        request.notificationId,
      )

      try {
        parseNotificationId(request.notificationId)

        await deleteNotificationForReplica(
          crypto,
          prisma,
          createTelegramBotClient,
          loadDeliveryConfig,
          {
            notificationId: request.notificationId,
          },
        )

        return {}
      } catch (error) {
        throwNotificationServiceError(
          error,
          "failed to delete telegram notification",
          "Failed to delete telegram notification",
        )
      }
    },
  }
}

export function throwNotificationServiceError(
  error: unknown,
  logMessage: string,
  publicMessage: string,
): never {
  if (error instanceof ConnectError) {
    throw error
  }

  logger.error({ error }, logMessage)
  throw new ConnectError(publicMessage, Code.Internal)
}

export function toApiNotification(notification: NotificationJson): ApiNotification {
  return fromJson(NotificationSchema, notification)
}

function requireNotificationReadModel(
  notification: NotificationJson | undefined,
): NotificationJson {
  if (notification === undefined) {
    throw new ConnectError("Notification read model is missing", Code.Internal)
  }

  return notification
}

function toBusinessTaskGroup(input: {
  id: string
  title: string
  tasks: { id: string; title: string; status: ApiNotificationTaskStatus }[]
}): NotificationTaskGroupInput {
  return {
    id: input.id,
    title: input.title,
    tasks: input.tasks.map(task => ({
      id: task.id,
      title: task.title,
      status: toBusinessNotificationTaskStatus(task.status),
    })),
  }
}

function toBusinessNotificationStatus(status: ApiNotificationStatus): NotificationStatus {
  switch (status) {
    case ApiNotificationStatus.PLANNING:
      return "PLANNING"
    case ApiNotificationStatus.IN_PROGRESS:
      return "IN_PROGRESS"
    case ApiNotificationStatus.COMPLETED:
      return "COMPLETED"
    case ApiNotificationStatus.FAILED:
      return "FAILED"
    case ApiNotificationStatus.REGULAR:
      return "REGULAR"
  }
}

function toBusinessNotificationTaskStatus(
  status: ApiNotificationTaskStatus,
): NotificationTaskStatus {
  switch (status) {
    case ApiNotificationTaskStatus.PENDING:
      return "PENDING"
    case ApiNotificationTaskStatus.IN_PROGRESS:
      return "IN_PROGRESS"
    case ApiNotificationTaskStatus.COMPLETED:
      return "COMPLETED"
    case ApiNotificationTaskStatus.FAILED:
      return "FAILED"
    case ApiNotificationTaskStatus.SKIPPED:
      return "SKIPPED"
    case ApiNotificationTaskStatus.PLANNED:
      return "PLANNED"
  }
}
