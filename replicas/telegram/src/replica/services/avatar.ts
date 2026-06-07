import type { AvatarServiceImplementation } from "@reside/api/interaction/avatar.v1"
import type { CommonServices, GenericOperationService } from "@reside/common"
import type { ResideCrypto } from "@reside/common/encryption"
import type { Client } from "@temporalio/client"
import type { Operation, PrismaClient } from "../../database"
import { create } from "@bufbuild/protobuf"
import { Code, ConnectError } from "@connectrpc/connect"
import { CoreV1Api } from "@kubernetes/client-node"
import { EnsureAvatarResponseSchema } from "@reside/api/interaction/avatar.v1"
import { authenticateReplica, getReplicaNamespace, kubeConfig, logger } from "@reside/common"
import { WellKnownPermissions } from "@reside/registry"
import { ensureAvatarProvision, updateAvatarVersionTag } from "../business/avatar"
import { createTelegramBotClient } from "../business/bot-client"
import {
  loadTelegramConfigState,
  TELEGRAM_CONFIG_MAP_NAME,
  TELEGRAM_SYSTEM_CHAT_ID_KEY,
} from "../business/config"
import { loadTelegramSecretState, TELEGRAM_BOT_TOKEN_SECRET_KEY } from "../business/secret"

export function createAvatarService(
  services: CommonServices<"access"> & {
    prisma: PrismaClient
    operationService: GenericOperationService<Operation>
    temporalClient: Client
    crypto: ResideCrypto
  },
): AvatarServiceImplementation {
  const namespace = getReplicaNamespace()
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)

  return {
    async ensureAvatar(request, context) {
      const { name: replicaName } = await authenticateReplica(context)
      const subjectId = `replica:${replicaName}`
      const replicaTitle = request.replicaTitle.trim()

      if (replicaTitle.length === 0) {
        throw new ConnectError("replicaTitle must not be empty", Code.InvalidArgument)
      }

      const authz = await services.authzService.checkPermission({
        permissionName: WellKnownPermissions.TELEGRAM_AVATAR_OWN,
        subjectId,
        scope: replicaName,
      })

      if (!authz.authorized) {
        throw new ConnectError(
          `Subject "${subjectId}" is not allowed to have avatar`,
          Code.PermissionDenied,
        )
      }

      const outcome = await ensureAvatarProvision(
        services.prisma,
        services.temporalClient,
        subjectId,
        replicaName,
        replicaTitle,
      )

      if (outcome.operationId === undefined) {
        logger.info(
          "ensureAvatar completed without operation for subject %s because avatar already exists",
          subjectId,
        )

        return create(EnsureAvatarResponseSchema, {
          operation: undefined,
        })
      }

      logger.info(
        "ensureAvatar returned operation %d for subject %s",
        outcome.operationId,
        subjectId,
      )

      return create(EnsureAvatarResponseSchema, {
        operation: await services.operationService.toApiOperation(outcome.operationId),
      })
    },

    async updateAvatarVersion(request, context) {
      const identity = await authenticateReplica(context)
      if (identity.name !== "alpha") {
        throw new ConnectError(
          `Replica "${identity.name}" is not allowed to update avatar versions`,
          Code.PermissionDenied,
        )
      }

      const replicaName = request.replicaName.trim()
      const newVersion = request.newVersion.trim()

      if (replicaName.length === 0) {
        throw new ConnectError("replicaName must not be empty", Code.InvalidArgument)
      }

      if (newVersion.length === 0) {
        throw new ConnectError("newVersion must not be empty", Code.InvalidArgument)
      }

      try {
        const [secretState, configState] = await Promise.all([
          loadTelegramSecretState(services.crypto),
          loadTelegramConfigState(coreApi, namespace),
        ])

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

        await updateAvatarVersionTag(services.prisma, createTelegramBotClient, {
          managerBotToken: secretState.botToken,
          systemChatId: configState.systemChatId,
          replicaName,
          newVersion,
        })

        return {}
      } catch (error) {
        const errorObject = error instanceof Error ? error : new Error(String(error))

        logger.error(
          { error: errorObject },
          'failed to update avatar version replica_name="%s" new_version="%s"',
          replicaName,
          newVersion,
        )

        if (error instanceof ConnectError) {
          throw error
        }

        throw new ConnectError("Failed to update avatar version", Code.Internal)
      }
    },
  }
}
