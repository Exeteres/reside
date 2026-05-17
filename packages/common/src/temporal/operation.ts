import type { Client } from "@temporalio/client"
import { toJson } from "@bufbuild/protobuf"
import { Code, type HandlerContext, ConnectError } from "@connectrpc/connect"
import {
  OperationSchema,
  OperationStatus,
  SubscribeToOperationCompletionResponseSchema,
  type OperationServiceClient,
  type OperationSubscriptionServiceImplementation,
} from "@reside/api/common/operation.v1"
import { authenticate } from "../auth"
import { logger } from "../logger"
import { getReplicaEndpoint } from "../kubernetes"
import { getOperationCompletedSignal } from "../workflow"

type OperationActivitiesService = Pick<
  OperationServiceClient,
  "subscribeToOperationCompletion" | "cancelOperation"
>

export function createOperationActivities(operationService: OperationActivitiesService) {
  return {
    subscribeToOperationCompletion: async (operationId: number, workflowId: string) => {
      const response = await operationService.subscribeToOperationCompletion({
        operationId,
        callbackEndpoint: `${getReplicaEndpoint()}:80`,
        customData: {
          workflowId,
        },
      })

      return toJson(SubscribeToOperationCompletionResponseSchema, response)
    },

    cancelOperation: async (operationId: number) => {
      await operationService.cancelOperation({
        operationId,
      })

      return
    },
  }
}

export type OperationActivities = ReturnType<typeof createOperationActivities>

export function createOperationSubscriptionService(
  temporalClient: Client,
): OperationSubscriptionServiceImplementation {
  return {
    async notifyOperationCompletion({ operation, customData }, context: HandlerContext) {
      await authenticate(context)

      if (!customData?.workflowId) {
        throw new Error(
          "No workflowId provided in customData for operation completion notification",
        )
      }

      const workflowId = customData.workflowId
      if (typeof workflowId !== "string") {
        throw new Error("customData.workflowId must be a string")
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
        const workflowHandle = temporalClient.workflow.getHandle(workflowId)

        await workflowHandle.signal(signalName, toJson(OperationSchema, operation))
      } catch (error) {
        logger.error(
          {
            error,
            workflowId,
            signalName,
            operationId: operation.id,
          },
          "failed to signal workflow from operation completion callback",
        )

        throw new ConnectError("Failed to notify operation completion", Code.Internal)
      }

      return {}
    },
  }
}
