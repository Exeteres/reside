import type { EnsureGatewayRequest } from "@reside/api/infra/gateway.v1"
import type { Client } from "@temporalio/client"
import type { PrismaClient } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"
import { DEFAULT_TEMPORAL_TASK_QUEUE } from "@reside/common"
import { WorkflowExecutionAlreadyStartedError, WorkflowIdReusePolicy } from "@temporalio/client"
import {
  GatewayOwnershipConflictError,
  InvalidGatewayNameError,
  MissingGatewayTitleError,
} from "../../definitions"
import { ensureGatewayRegistration } from "../../shared"

const ENSURE_GATEWAY_WORKFLOW_TYPE = "ensureGatewayWorkflow"

export async function ensureGatewayRegistrationOrThrow(
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

export function assertValidGatewayRequest(request: EnsureGatewayRequest): void {
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

export async function startEnsureGatewayWorkflow(
  temporalClient: Client,
  operationId: number,
): Promise<void> {
  try {
    await temporalClient.workflow.start(ENSURE_GATEWAY_WORKFLOW_TYPE, {
      args: [{ operationId }],
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
