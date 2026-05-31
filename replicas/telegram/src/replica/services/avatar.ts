import type { AvatarServiceImplementation } from "@reside/api/interaction/avatar.v1"
import type { CommonServices, GenericOperationService } from "@reside/common"
import type { Client } from "@temporalio/client"
import type { Operation, PrismaClient } from "../../database"
import { create } from "@bufbuild/protobuf"
import { Code, ConnectError } from "@connectrpc/connect"
import { EnsureAvatarResponseSchema } from "@reside/api/interaction/avatar.v1"
import { authenticateReplica, logger } from "@reside/common"
import { WellKnownPermissions } from "@reside/registry"
import { ensureAvatarProvision } from "../business/avatar"

export function createAvatarService(
  services: CommonServices<"access"> & {
    prisma: PrismaClient
    operationService: GenericOperationService<Operation>
    temporalClient: Client
  },
): AvatarServiceImplementation {
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
  }
}
