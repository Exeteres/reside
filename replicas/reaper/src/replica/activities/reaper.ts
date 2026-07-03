import type { OperationServiceClient } from "@reside/api/common/operation.v1"
import type { ReaperActivities } from "../../definitions"
import type { ReaperServices } from "../../shared"
import { toJson } from "@bufbuild/protobuf"
import { Code, ConnectError } from "@connectrpc/connect"
import { OperationSchema, OperationService } from "@reside/api/common/operation.v1"
import {
  ExecuteActionsResponseSchema,
  PreviewActionsResponseSchema,
  ReplicaReaperHandler,
} from "@reside/api/reaper/handler.v1"
import { createChannel, createClient } from "@reside/common"
import { listReaperHandlers } from "../business"

type ReaperActivityServices = Pick<ReaperServices, "prisma">

export function createReaperActivities({ prisma }: ReaperActivityServices): ReaperActivities {
  return {
    async listReaperHandlers() {
      const handlers = await listReaperHandlers(prisma)

      return {
        handlers: handlers.map(handler => ({
          resourceReplicaName: handler.resourceReplicaName,
          title: handler.title,
          callbackEndpoint: handler.callbackEndpoint,
        })),
      }
    },

    async previewHandlerActions(input) {
      const client = createClient(ReplicaReaperHandler, createChannel(input.callbackEndpoint))
      const response = await client.previewActions({
        replicaName: input.targetReplicaName,
      })
      const jsonResponse = toJson(PreviewActionsResponseSchema, response)

      return {
        actions: (jsonResponse.actions ?? []).map((action, _index) => ({
          id: requireValue(action.id, "action id"),
          resourceReplicaName: input.resourceReplicaName,
          title: requireValue(action.title, "action title"),
          payload: requireValue(action.payload, "action payload"),
          hints: action.hints ?? [],
        })),
      }
    },

    async executeHandlerActions(input) {
      const client = createClient(ReplicaReaperHandler, createChannel(input.callbackEndpoint))
      const response = await client.executeActions({
        payloads: input.payloads,
      })
      const jsonResponse = toJson(ExecuteActionsResponseSchema, response)

      return {
        executions: (jsonResponse.executions ?? []).map(execution => ({
          payload: requireValue(execution.payload, "execution payload"),
          operation: execution.operation,
          completed: execution.completed !== undefined,
        })),
      }
    },

    async getResourceOperation(input) {
      const client = createClient(OperationService, createChannel(input.callbackEndpoint))
      const response = await getOperationIfAvailable(client, input.operationId)

      if (response === undefined) {
        return {
          found: false,
        }
      }

      if (!response.operation) {
        throw new Error(`Operation "${input.operationId}" response is missing operation`)
      }

      return {
        found: true,
        operation: toJson(OperationSchema, response.operation),
      }
    },
  }
}

async function getOperationIfAvailable(
  client: Pick<OperationServiceClient, "getOperation">,
  operationId: number,
) {
  try {
    return await client.getOperation({
      operationId,
    })
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      return undefined
    }

    throw error
  }
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value !== undefined) {
    return value
  }

  throw new Error(`Reaper handler response is missing ${label}`)
}
