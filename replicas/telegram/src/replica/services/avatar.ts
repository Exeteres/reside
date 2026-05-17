import type { HandlerContext } from "@connectrpc/connect"
import type {
  AvatarServiceImplementation,
  EnsureAvatarRequest,
} from "@reside/api/interaction/avatar.v1"
import type { CommonServices, GenericOperationService } from "@reside/common"
import type { Client } from "@temporalio/client"
import type { Operation, PrismaClient } from "../../database"
import { create } from "@bufbuild/protobuf"
import { Code, ConnectError } from "@connectrpc/connect"
import { EnsureAvatarResponseSchema } from "@reside/api/interaction/avatar.v1"
import { authenticateReplica, DEFAULT_TEMPORAL_TASK_QUEUE, logger } from "@reside/common"
import { WellKnownPermissions } from "@reside/registry"
import { WorkflowIdReusePolicy } from "@temporalio/client"
import {
  getTelegramAvatarProvisionWorkflowId,
  TELEGRAM_AVATAR_PROVISION_WORKFLOW_TYPE,
} from "../../definitions"
import { strings } from "../../locale"

export function createAvatarService({
  prisma,
  operationService,
  authzService,
  temporalClient,
}: CommonServices<"access"> & {
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
  temporalClient: Client
}): AvatarServiceImplementation {
  return {
    async ensureAvatar(request: EnsureAvatarRequest, context: HandlerContext) {
      const { name: replicaName } = await authenticateReplica(context)
      const subjectId = `replica:${replicaName}`
      const replicaTitle = request.replicaTitle.trim()

      if (replicaTitle.length === 0) {
        throw new ConnectError("replicaTitle must not be empty", Code.InvalidArgument)
      }

      const authz = await authzService.checkPermission({
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

      const existingAvatar = await prisma.avatar.findUnique({
        where: {
          subjectId,
        },
        select: {
          id: true,
        },
      })

      if (existingAvatar) {
        logger.info(
          "ensureAvatar completed without operation for subject %s because avatar already exists",
          subjectId,
        )
        return create(EnsureAvatarResponseSchema, {
          operation: undefined,
        })
      }

      const pendingProvision = await prisma.avatarProvisionRequest.findFirst({
        where: {
          subjectId,
          operation: {
            status: "PENDING",
          },
        },
        orderBy: {
          id: "desc",
        },
        select: {
          operationId: true,
        },
      })

      if (pendingProvision) {
        logger.info(
          "ensureAvatar reused pending operation %d for subject %s",
          pendingProvision.operationId,
          subjectId,
        )

        return create(EnsureAvatarResponseSchema, {
          operation: await operationService.toApiOperation(pendingProvision.operationId),
        })
      }

      const expectedPrefix = `reside_${replicaName}`

      const created = await prisma.$transaction(async tx => {
        const operation = await tx.operation.create({
          data: {
            title: strings.server.notification.avatarProvisionOperationTitle,
            description: strings.server.notification.avatarProvisionOperationDescription,
          },
          select: {
            id: true,
          },
        })

        await tx.avatarProvisionRequest.create({
          data: {
            operationId: operation.id,
            subjectId,
            replicaName,
            replicaTitle,
            expectedPrefix,
          },
        })

        return operation
      })

      await temporalClient.workflow.start(TELEGRAM_AVATAR_PROVISION_WORKFLOW_TYPE, {
        args: [
          {
            operationId: created.id,
          },
        ],
        workflowId: getTelegramAvatarProvisionWorkflowId(created.id),
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
      })

      logger.info(
        "started avatar provisioning workflow for subject %s and operation %d",
        subjectId,
        created.id,
      )

      return create(EnsureAvatarResponseSchema, {
        operation: await operationService.toApiOperation(created.id),
      })
    },
  }
}
