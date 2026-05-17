import type { HandlerContext } from "@connectrpc/connect"
import type {
  EnsureGatewayRequest,
  GatewayServiceImplementation,
} from "@reside/api/infra/gateway.v1"
import type { GenericOperationService } from "@reside/common"
import type { Client } from "@temporalio/client"
import type { Operation, PrismaClient } from "../../database"
import { create } from "@bufbuild/protobuf"
import { Code, ConnectError } from "@connectrpc/connect"
import { EnsureGatewayResponseSchema } from "@reside/api/infra/gateway.v1"
import {
  authenticateReplica,
  type CommonServices,
  DEFAULT_TEMPORAL_TASK_QUEUE,
} from "@reside/common"
import { WellKnownPermissions } from "@reside/registry"
import { WorkflowExecutionAlreadyStartedError, WorkflowIdReusePolicy } from "@temporalio/client"
import { OperationStatus, OperationType } from "../../database"
import { strings } from "../../locale"
import {
  ensureGatewayRegistration,
  GatewayOwnershipConflictError,
  InvalidGatewayNameError,
  MissingGatewayTitleError,
} from "../../shared"

const ENSURE_GATEWAY_WORKFLOW_TYPE = "ensureGatewayWorkflow"

export function createGatewayService({
  prisma,
  operationService,
  authzService,
  temporalClient,
}: CommonServices<"access"> & {
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
  temporalClient: Client
}): GatewayServiceImplementation {
  return {
    async ensureGateway(request: EnsureGatewayRequest, context: HandlerContext) {
      const { name: replicaName } = await authenticateReplica(context)
      const subjectId = `replica:${replicaName}`

      assertValidGatewayRequest(request)
      const normalizedGatewayName = request.name.trim()

      const authz = await authzService.checkPermission({
        permissionName: WellKnownPermissions.INFRA_GATEWAY_MANAGE,
        subjectId,
        scope: normalizedGatewayName,
      })

      if (!authz.authorized) {
        throw new ConnectError(
          `Subject "${subjectId}" is not allowed to manage gateway "${normalizedGatewayName}"`,
          Code.PermissionDenied,
        )
      }

      const registration = await ensureGatewayRegistrationOrThrow(prisma, request, replicaName)

      if (!registration.changed) {
        return create(EnsureGatewayResponseSchema, {
          operation: undefined,
        })
      }

      const pendingOperation = await prisma.operation.findFirst({
        where: {
          type: OperationType.ENSURE_GATEWAY,
          status: OperationStatus.PENDING,
          gateway: {
            name: registration.name,
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
        },
      })

      if (pendingOperation !== null) {
        return create(EnsureGatewayResponseSchema, {
          operation: await operationService.toApiOperation(pendingOperation.id),
        })
      }
      const operation = await prisma.operation.create({
        data: {
          title: strings.operations.gateway.title(registration.name),
          description: strings.operations.gateway.description(registration.name),
          type: OperationType.ENSURE_GATEWAY,
          status: OperationStatus.PENDING,
          failureReason: null,
          failureMessage: null,
          callbackEndpoint: null,
          resolvedAt: null,
          gatewayId: registration.id,
        },
        select: {
          id: true,
        },
      })

      await startEnsureGatewayWorkflow(temporalClient, operation.id)

      return create(EnsureGatewayResponseSchema, {
        operation: await operationService.toApiOperation(operation.id),
      })
    },
  }
}

async function ensureGatewayRegistrationOrThrow(
  prisma: PrismaClient,
  request: EnsureGatewayRequest,
  replicaName: string,
) {
  try {
    return await ensureGatewayRegistration(prisma, {
      name: request.name,
      ownerReplicaName: replicaName,
      title: request.title,
      description: request.description,
    })
  } catch (error) {
    if (error instanceof InvalidGatewayNameError || error instanceof MissingGatewayTitleError) {
      throw new ConnectError(error.message, Code.InvalidArgument)
    }

    if (error instanceof GatewayOwnershipConflictError) {
      throw new ConnectError(error.message, Code.AlreadyExists)
    }

    throw error
  }
}

function assertValidGatewayRequest(request: EnsureGatewayRequest): void {
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(request.name.trim())) {
    throw new ConnectError(
      "Gateway name must be a valid DNS label in lowercase",
      Code.InvalidArgument,
    )
  }

  if (request.title.trim().length === 0) {
    throw new ConnectError("Gateway title is required", Code.InvalidArgument)
  }
}

async function startEnsureGatewayWorkflow(
  temporalClient: Client,
  operationId: number,
): Promise<void> {
  try {
    await temporalClient.workflow.start(ENSURE_GATEWAY_WORKFLOW_TYPE, {
      args: [operationId],
      workflowId: `ensure-gateway-${operationId}`,
      taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
    })
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      return
    }

    if (error instanceof Error) {
      throw new ConnectError(error.message, Code.Internal)
    }

    throw new ConnectError("Failed to schedule gateway provisioning workflow", Code.Internal)
  }
}
