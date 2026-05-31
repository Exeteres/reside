import type { NotificationServiceImplementation } from "@reside/api/interaction/notification.v1"
import type { Operation, PrismaClient } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"
import { CoreV1Api } from "@kubernetes/client-node"
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
  assertActionRows,
  parseNotificationId,
  sendNotificationForReplica,
  updateNotificationForReplica,
} from "../business/notification"
import { loadTelegramSecretState, TELEGRAM_SECRET_NAME } from "../business/secret"

export function createNotificationService({
  prisma,
  authzService,
  subjectService,
  operationService,
}: CommonServices<"access"> & {
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
}): NotificationServiceImplementation {
  const namespace = getReplicaNamespace()
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)

  async function loadDeliveryConfig(): Promise<{ botToken: string; systemChatId: string }> {
    const secretState = await loadTelegramSecretState(coreApi, namespace)
    const configState = await loadTelegramConfigState(coreApi, namespace)

    if (!secretState.botToken) {
      throw new ConnectError(
        `Secret "${TELEGRAM_SECRET_NAME}" must contain "bot_token"`,
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
          },
        )

        return {
          notificationId: result.notificationId,
          operation:
            result.operationId === undefined
              ? undefined
              : await operationService.toApiOperation(result.operationId),
        }
      } catch (error) {
        logger.error({ error }, "failed to send telegram notification")
        throw new ConnectError("Failed to send telegram notification", Code.Internal)
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
          },
        )

        return {
          operation:
            result.operationId === undefined
              ? undefined
              : await operationService.toApiOperation(result.operationId),
        }
      } catch (error) {
        logger.error({ error }, "failed to update telegram notification")
        throw new ConnectError("Failed to update telegram notification", Code.Internal)
      }
    },
  }
}
