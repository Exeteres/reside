import type { TopicServiceImplementation } from "@reside/api/interaction/topic.v1"
import type { ResideCrypto } from "@reside/common/encryption"
import type { PrismaClient } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"
import { CoreV1Api } from "@kubernetes/client-node"
import {
  authenticateReplica,
  type CommonServices,
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
  createNotificationTopicForReplica,
  deleteNotificationTopicForReplica,
  updateNotificationTopicForReplica,
} from "../business/notification-topic"
import { loadTelegramSecretState, TELEGRAM_BOT_TOKEN_SECRET_KEY } from "../business/secret"

export function createTopicService({
  prisma,
  authzService,
  crypto,
}: CommonServices<"access"> & {
  prisma: PrismaClient
  crypto: ResideCrypto
}): TopicServiceImplementation {
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
    async createTopic(request, context) {
      const { name: replicaName } = await authenticateReplica(context)

      logger.info(
        "createTopic requested by replica %s for channel %s",
        replicaName,
        request.channel,
      )

      try {
        return await createNotificationTopicForReplica(
          crypto,
          prisma,
          authzService,
          createTelegramBotClient,
          loadDeliveryConfig,
          replicaName,
          {
            channel: request.channel,
            title: request.title,
            createAsSubjectId: request.createAsSubjectId,
          },
        )
      } catch (error) {
        if (error instanceof ConnectError) {
          throw error
        }

        const errorObject = error instanceof Error ? error : new Error(String(error))
        logger.error({ error: errorObject }, "failed to create telegram topic")
        throw new ConnectError("Failed to create telegram topic", Code.Internal)
      }
    },

    async updateTopic(request, context) {
      const { name: replicaName } = await authenticateReplica(context)
      logger.info(
        "updateTopic requested by replica %s for topicId %s",
        replicaName,
        request.topicId,
      )

      try {
        await updateNotificationTopicForReplica(
          crypto,
          prisma,
          createTelegramBotClient,
          loadDeliveryConfig,
          {
            topicId: request.topicId,
            title: request.title,
          },
        )

        return {}
      } catch (error) {
        if (error instanceof ConnectError) {
          throw error
        }

        const errorObject = error instanceof Error ? error : new Error(String(error))
        logger.error({ error: errorObject }, "failed to update telegram topic")
        throw new ConnectError("Failed to update telegram topic", Code.Internal)
      }
    },

    async deleteTopic(request, context) {
      const { name: replicaName } = await authenticateReplica(context)
      logger.info(
        "deleteTopic requested by replica %s for topicId %s",
        replicaName,
        request.topicId,
      )

      try {
        await deleteNotificationTopicForReplica(
          crypto,
          prisma,
          createTelegramBotClient,
          loadDeliveryConfig,
          {
            topicId: request.topicId,
          },
        )

        return {}
      } catch (error) {
        if (error instanceof ConnectError) {
          throw error
        }

        const errorObject = error instanceof Error ? error : new Error(String(error))
        logger.error({ error: errorObject }, "failed to delete telegram topic")
        throw new ConnectError("Failed to delete telegram topic", Code.Internal)
      }
    },
  }
}
