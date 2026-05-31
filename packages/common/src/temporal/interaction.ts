import {
  SendNotificationResponseSchema,
  UpdateNotificationResponseSchema,
  type NotificationServiceClient,
  type SendNotificationRequest,
  type UpdateNotificationRequest,
} from "@reside/api/interaction/notification.v1"
import { authenticate } from "../auth"
import { createOperationActivities } from "./operation"
import type { CommandHandlerServiceImplementation } from "@reside/api/interaction/command.v1"
import { CommandInvocationSchema } from "@reside/api/interaction/command.v1"
import type { Client as TemporalClient } from "@temporalio/client"
import { toJson } from "@bufbuild/protobuf"
import type { OperationServiceClient } from "@reside/api/common/operation.v1"
import { DEFAULT_TEMPORAL_TASK_QUEUE } from "../database"

export function createInteractionActivities(
  notificationService: NotificationServiceClient,
  interactionOperationService: OperationServiceClient,
) {
  return {
    sendNotification: async (request: SendNotificationRequest) => {
      const response = await notificationService.sendNotification(request)

      return toJson(SendNotificationResponseSchema, response)
    },

    updateNotification: async (request: UpdateNotificationRequest) => {
      const response = await notificationService.updateNotification(request)

      return toJson(UpdateNotificationResponseSchema, response)
    },

    ...createOperationActivities(interactionOperationService),
  }
}

export type InteractionActivities = ReturnType<typeof createInteractionActivities>

export function createCommandHandlerService(
  temporalClient: TemporalClient,
): CommandHandlerServiceImplementation {
  return {
    async invokeCommand(invocation, context) {
      await authenticate(context)

      await temporalClient.workflow.start("handleCommandWorkflow", {
        workflowId: `handle-command-${invocation.invocationId}`,
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        args: [toJson(CommandInvocationSchema, invocation)],
      })

      return {}
    },
  }
}
