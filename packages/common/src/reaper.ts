import type { ServiceImpl } from "@connectrpc/connect"
import type { Operation } from "@reside/api/common/operation.v1"
import type { z } from "zod"
import type { ResideCrypto } from "./encryption"
import { create } from "@bufbuild/protobuf"
import { EmptySchema } from "@bufbuild/protobuf/wkt"
import { Code, ConnectError } from "@connectrpc/connect"
import {
  ExecuteActionsResponseSchema,
  PreviewActionsResponseSchema,
  ReaperActionExecutionSchema,
  type ReaperActionHint,
  ReaperActionSchema,
  type ReplicaReaperHandler,
} from "@reside/api/reaper/handler.v1"
import { authenticateReplica } from "./auth"
import { rhid } from "./rhid"

export type ReaperActionDefinition<TSchema extends z.ZodTypeAny> = {
  schema: TSchema
  execute: (id: string, payload: z.infer<TSchema>) => Promise<ReaperActionExecutionResult>
}

export type ReaperAsyncActionExecutionResult = {
  type: "operation"
  operation: Operation
}

export type ReaperCompletedActionExecutionResult = {
  type: "completed"
}

export type ReaperActionExecutionResult =
  | ReaperAsyncActionExecutionResult
  | ReaperCompletedActionExecutionResult

export type ReaperActionSchemas = Record<string, z.ZodTypeAny>

export type ReaperActionDefinitions<TSchemas extends ReaperActionSchemas> = {
  [TName in keyof TSchemas & string]: ReaperActionDefinition<TSchemas[TName]>
}

export type ReaperPreviewAction<TSchemas extends ReaperActionSchemas> = {
  [TName in keyof TSchemas & string]: {
    name: TName
    title: string
    payload: z.infer<TSchemas[TName]>
    hints?: ReaperActionHint[]
  }
}[keyof TSchemas & string]

export type ReaperExecuteAction<TSchemas extends ReaperActionSchemas> = {
  [TName in keyof TSchemas & string]: {
    id: string
    name: TName
    payloadEcid: string
    payload: z.infer<TSchemas[TName]>
  }
}[keyof TSchemas & string]

export type ReaperExecuteResult = {
  payloadEcid: string
  result: ReaperActionExecutionResult
}

export type CreateReaperHandlerOptions<TSchemas extends ReaperActionSchemas> = {
  crypto: ResideCrypto
  actions: ReaperActionDefinitions<TSchemas>
  preview: (replicaName: string) => Promise<ReaperPreviewAction<TSchemas>[]>
}

type StoredReaperAction = {
  id: string
  name: string
  payload: unknown
}

/**
 * Creates a typed reaper handler implementation with encrypted action payloads.
 *
 * @param options The typed action schemas, preview callback, execute callback, and crypto dependency.
 * @returns A ReplicaReaperHandler service implementation.
 */
export function createReaperHandler<const TSchemas extends ReaperActionSchemas>({
  crypto,
  actions,
  preview,
}: CreateReaperHandlerOptions<TSchemas>): ServiceImpl<typeof ReplicaReaperHandler> {
  return {
    async previewActions(request, context) {
      await authenticateReplica(context)
      assertReplicaName(request.replicaName)

      const previewActions = await preview(request.replicaName)

      return create(PreviewActionsResponseSchema, {
        actions: await Promise.all(
          previewActions.map(async action => {
            assertKnownAction(actions, action.name)
            const actionId = createReaperActionId(action.name, action.payload)

            return create(ReaperActionSchema, {
              id: actionId,
              title: action.title,
              payload: await crypto.encrypt({
                id: actionId,
                name: action.name,
                payload: action.payload,
              } satisfies StoredReaperAction),
              hints: action.hints ?? [],
            })
          }),
        ),
      })
    },

    async executeActions(request, context) {
      await authenticateReplica(context)

      const parsedActions: ReaperExecuteAction<TSchemas>[] = []
      for (const payloadEcid of request.payloads) {
        const storedAction = await crypto.decrypt(storedReaperActionSchema, payloadEcid)
        assertKnownAction(actions, storedAction.name)
        const definition = actions[storedAction.name]!
        const payload = definition.schema.parse(storedAction.payload)
        const expectedActionId = createReaperActionId(storedAction.name, payload)
        if (storedAction.id !== expectedActionId) {
          throw new ConnectError("Invalid reaper action id", Code.InvalidArgument)
        }

        parsedActions.push({
          id: storedAction.id,
          name: storedAction.name,
          payloadEcid,
          payload,
        } as ReaperExecuteAction<TSchemas>)
      }

      const executions = await Promise.all(
        parsedActions.map(async action => await executeReaperAction(actions, action)),
      )

      return create(ExecuteActionsResponseSchema, {
        executions: executions.map(execution =>
          create(ReaperActionExecutionSchema, {
            payload: execution.payloadEcid,
            result:
              execution.result.type === "operation"
                ? {
                    case: "operation",
                    value: execution.result.operation,
                  }
                : {
                    case: "completed",
                    value: create(EmptySchema),
                  },
          }),
        ),
      })
    },
  }
}

const storedReaperActionSchema = {
  parse(value: unknown): StoredReaperAction {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ConnectError("Invalid reaper action payload", Code.InvalidArgument)
    }

    const record = value as Record<string, unknown>
    if (typeof record.id !== "string" || record.id.length === 0) {
      throw new ConnectError("Invalid reaper action id", Code.InvalidArgument)
    }

    if (typeof record.name !== "string" || record.name.length === 0) {
      throw new ConnectError("Invalid reaper action name", Code.InvalidArgument)
    }

    return {
      id: record.id,
      name: record.name,
      payload: record.payload,
    }
  },
} as z.ZodType<StoredReaperAction>

function assertReplicaName(replicaName: string): void {
  if (/^[a-z][a-z0-9-]*$/.test(replicaName)) {
    return
  }

  throw new ConnectError("Replica name is invalid", Code.InvalidArgument)
}

function createReaperActionId(actionName: string, payload: unknown): string {
  return rhid({
    actionName,
    payload,
  })
}

export function operationReaperAction(operation: Operation): ReaperAsyncActionExecutionResult {
  return {
    type: "operation",
    operation,
  }
}

export function completeReaperAction(): ReaperCompletedActionExecutionResult {
  return {
    type: "completed",
  }
}

async function executeReaperAction<
  TSchemas extends ReaperActionSchemas,
  TName extends keyof TSchemas & string,
>(
  actions: ReaperActionDefinitions<TSchemas>,
  action: ReaperExecuteAction<TSchemas> & { name: TName },
): Promise<ReaperExecuteResult> {
  const definition = actions[action.name]

  return {
    payloadEcid: action.payloadEcid,
    result: await definition.execute(action.id, action.payload),
  }
}

function assertKnownAction<TSchemas extends ReaperActionSchemas>(
  actions: ReaperActionDefinitions<TSchemas>,
  actionName: string,
): asserts actionName is keyof TSchemas & string {
  if (Object.hasOwn(actions, actionName)) {
    return
  }

  throw new ConnectError(`Unknown reaper action "${actionName}"`, Code.InvalidArgument)
}
