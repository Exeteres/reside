import type { OperationJson } from "@reside/api/common/operation.v1"
import type { ReaperActionHintJson } from "@reside/api/reaper/handler.v1"

export type RegisteredReaperHandler = {
  /**
   * The technical name of the resource holder replica.
   */
  resourceReplicaName: string

  /**
   * The human-readable title used for task group rendering.
   */
  title: string

  /**
   * The endpoint implementing ReplicaReaperHandler and OperationService.
   */
  callbackEndpoint: string
}

export type ReaperPlannedAction = {
  /**
   * The deterministic action identifier returned by the resource holder.
   */
  id: string

  /**
   * The resource holder replica name.
   */
  resourceReplicaName: string

  /**
   * The human-readable action title.
   */
  title: string

  /**
   * The encrypted opaque action payload.
   */
  payload: string

  /**
   * The optional execution hints attached to this action.
   */
  hints: ReaperActionHintJson[]
}

export type StartedReaperExecution = {
  /**
   * The encrypted opaque payload this execution result belongs to.
   */
  payload: string

  /**
   * The resource holder operation, when the action is asynchronous.
   */
  operation?: OperationJson

  /**
   * Whether the action has already completed synchronously.
   */
  completed: boolean
}

export type PreviewHandlerActionsInput = {
  /**
   * The handler endpoint to call.
   */
  callbackEndpoint: string

  /**
   * The resource holder replica name.
   */
  resourceReplicaName: string

  /**
   * The target replica name being killed.
   */
  targetReplicaName: string
}

export type PreviewHandlerActionsOutput = {
  /**
   * The planned actions returned by the handler.
   */
  actions: ReaperPlannedAction[]
}

export type ExecuteHandlerActionsInput = {
  /**
   * The handler endpoint to call.
   */
  callbackEndpoint: string

  /**
   * The encrypted opaque payloads selected for execution.
   */
  payloads: string[]
}

export type ExecuteHandlerActionsOutput = {
  /**
   * The execution results returned by the handler.
   */
  executions: StartedReaperExecution[]
}

export type GetResourceOperationInput = {
  /**
   * The resource holder endpoint to poll.
   */
  callbackEndpoint: string

  /**
   * The resource holder operation identifier.
   */
  operationId: number
}

export type GetResourceOperationOutput = {
  /**
   * The latest operation state when it is still available from the resource holder.
   */
  operation?: OperationJson

  /**
   * Whether the resource holder still has this operation.
   */
  found: boolean
}

export type ReaperActivities = {
  /**
   * Lists all registered reaper handlers.
   */
  listReaperHandlers: () => Promise<{ handlers: RegisteredReaperHandler[] }>

  /**
   * Previews actions from one resource holder handler.
   */
  previewHandlerActions: (input: PreviewHandlerActionsInput) => Promise<PreviewHandlerActionsOutput>

  /**
   * Executes selected actions through one resource holder handler.
   */
  executeHandlerActions: (input: ExecuteHandlerActionsInput) => Promise<ExecuteHandlerActionsOutput>

  /**
   * Polls a resource holder operation.
   */
  getResourceOperation: (input: GetResourceOperationInput) => Promise<GetResourceOperationOutput>
}
