import type { OperationServiceClient, DeepPartial } from "@reside/api/common/operation.v1"
import type {
  NotificationServiceClient,
  SendNotificationRequest,
  UpdateNotificationRequest,
} from "@reside/api/interaction/notification.v1"
import { authenticate } from "../auth"
import { createOperationActivities } from "./operation"
import type { CommandHandlerServiceImplementation } from "@reside/api/interaction/command.v1"
import type { Client } from "@temporalio/client"
import { getReplicaNamespace } from "../kubernetes"
import type { CallContext } from "nice-grpc"

export type CommonActivitiesOptions = {
  /**
   * The service client used to interact with users via notifications.
   */
  notificationService: NotificationServiceClient

  /**
   * The interaction operation service client used to track interaction operations.
   */
  operationService: OperationServiceClient
}

export function createInteractionActivities({
  notificationService,
  operationService,
}: CommonActivitiesOptions) {
  return {
    sendNotification: async (request: DeepPartial<SendNotificationRequest>) => {
      return await notificationService.sendNotification(request)
    },

    updateNotification: async (request: DeepPartial<UpdateNotificationRequest>) => {
      return await notificationService.updateNotification(request)
    },

    ...createOperationActivities(operationService),
  }
}

export type InteractionActivities = ReturnType<typeof createInteractionActivities>

export function createCommandHandlerService(
  temporalClient: Client,
): CommandHandlerServiceImplementation {
  return {
    async invokeCommand(invocation, context: CallContext) {
      await authenticate(context)

      await temporalClient.workflow.start("handleCommandWorkflow", {
        workflowId: `handle-command-${invocation.invocationId}`,
        taskQueue: getReplicaNamespace(),
        args: [invocation],
      })

      return {}
    },
  }
}
