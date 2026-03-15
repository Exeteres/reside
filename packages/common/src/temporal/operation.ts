import { status as grpcStatus } from "@grpc/grpc-js"
import type { Client } from "@temporalio/client"
import { type CallContext, ServerError } from "nice-grpc"
import {
  type OperationServiceClient,
  OperationStatus,
  type OperationSubscriptionServiceImplementation,
} from "@reside/api/common/operation.v1"
import { authenticate } from "../auth"
import { logger } from "../logger"
import { getReplicaEndpoint } from "../kubernetes"
import { getOperationCompletedSignal } from "../workflow"

export function createOperationActivities(operationService: OperationServiceClient) {
  return {
    subscribeToOperationCompletion: async (operationId: number, workflowId: string) => {
      return await operationService.subscribeToOperationCompletion({
        operationId,
        callbackEndpoint: `${getReplicaEndpoint()}:80`,
        customData: {
          workflowId,
        },
      })
    },

    cancelOperation: async (operationId: number) => {
      return await operationService.cancelOperation({
        operationId,
      })
    },
  }
}

export type OperationActivities = ReturnType<typeof createOperationActivities>

export function createOperationSubscriptionService(
  temporalClient: Client,
): OperationSubscriptionServiceImplementation {
  return {
    async notifyOperationCompletion({ operation, customData }, context: CallContext) {
      await authenticate(context)

      if (!customData?.workflowId) {
        throw new Error(
          "No workflowId provided in customData for operation completion notification",
        )
      }

      if (!operation) {
        throw new Error("No operation provided in operation completion notification")
      }

      if (
        operation.status !== OperationStatus.COMPLETED &&
        operation.status !== OperationStatus.FAILED
      ) {
        throw new Error(
          `Operation completion notification received for operation ${operation.id} with non-terminal status ${operation.status}`,
        )
      }

      const signalName = getOperationCompletedSignal(operation.id).name

      try {
        const workflowHandle = temporalClient.workflow.getHandle(customData.workflowId)

        await workflowHandle.signal(signalName, operation)
      } catch (error) {
        logger.error(
          {
            error,
            workflowId: customData.workflowId,
            signalName,
            operationId: operation.id,
          },
          "failed to signal workflow from operation completion callback",
        )

        throw new ServerError(grpcStatus.INTERNAL, "Failed to notify operation completion")
      }

      return {}
    },
  }
}
