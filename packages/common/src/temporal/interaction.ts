import type { OperationServiceClient } from "@reside/api/common/operation.v1"
import type { CommandHandlerServiceImplementation } from "@reside/api/interaction/command.v1"
import type {
  CloseTopicRequest,
  CreateTopicRequest,
  DeleteTopicRequest,
  ReopenTopicRequest,
  TopicServiceClient,
  UpdateTopicRequest,
} from "@reside/api/interaction/topic.v1"
import type { Client as TemporalClient } from "@temporalio/client"
import { toJson } from "@bufbuild/protobuf"
import { CommandInvocationSchema } from "@reside/api/interaction/command.v1"
import {
  type AcceptNotificationResponseRequest,
  AcceptNotificationResponseResponseSchema,
  type DeleteNotificationRequest,
  type NotificationServiceClient,
  type SendNotificationRequest,
  SendNotificationResponseSchema,
  type UpdateNotificationRequest,
  UpdateNotificationResponseSchema,
} from "@reside/api/interaction/notification.v1"
import { CreateTopicResponseSchema } from "@reside/api/interaction/topic.v1"
import { authenticate } from "../auth"
import { DEFAULT_TEMPORAL_TASK_QUEUE } from "../database"
import { createOperationActivities } from "./operation"

export function createInteractionActivities(
  notificationService: NotificationServiceClient,
  interactionOperationService: OperationServiceClient,
  topicService?: TopicServiceClient,
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

    acceptNotificationResponse: async (request: AcceptNotificationResponseRequest) => {
      const response = await notificationService.acceptNotificationResponse(request)

      return toJson(AcceptNotificationResponseResponseSchema, response)
    },

    deleteNotification: async (request: DeleteNotificationRequest) => {
      await notificationService.deleteNotification(request)

      return {}
    },

    createTopic: async (request: CreateTopicRequest) => {
      if (!topicService) {
        throw new Error("Topic service is not configured")
      }

      const response = await topicService.createTopic(request)

      return toJson(CreateTopicResponseSchema, response)
    },

    updateTopic: async (request: UpdateTopicRequest) => {
      if (!topicService) {
        throw new Error("Topic service is not configured")
      }

      await topicService.updateTopic(request)

      return {}
    },

    deleteTopic: async (request: DeleteTopicRequest) => {
      if (!topicService) {
        throw new Error("Topic service is not configured")
      }

      await topicService.deleteTopic(request)

      return {}
    },

    closeTopic: async (request: CloseTopicRequest) => {
      if (!topicService) {
        throw new Error("Topic service is not configured")
      }

      await topicService.closeTopic(request)

      return {}
    },

    reopenTopic: async (request: ReopenTopicRequest) => {
      if (!topicService) {
        throw new Error("Topic service is not configured")
      }

      await topicService.reopenTopic(request)

      return {}
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
