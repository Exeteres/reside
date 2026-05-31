import type { OperationJson } from "@reside/api/common/operation.v1"
import { condition, defineSignal, log, setHandler, workflowInfo } from "@temporalio/workflow"
import type { OperationActivities } from "../temporal"

/**
 * Waits for an operation to resolve to a completed state (either success or failure) by subscribing to its completion via the operation service.
 * The workflow will be suspended and resumed when the operation completion signal is received.
 * If subscribing to the operation completion fails, the error is thrown.
 * If the operation resolves to a failed state, the error is thrown as well.
 *
 * @param operationId The ID of the operation to wait for.
 * @param subscribeToOperationCompletion The activity function used to subscribe to the operation completion.
 * @returns The final state of the operation after it has completed.
 */
export async function waitForOperation(
  operationId: number,
  subscribeToOperationCompletion: OperationActivities["subscribeToOperationCompletion"],
): Promise<OperationJson> {
  log.info("subscribing to operation completion", { operationId })

  const subscribeResult = await subscribeToOperationCompletion(
    operationId,
    workflowInfo().workflowId,
  )

  if (subscribeResult.completedOperation) {
    log.info("operation already completed on subscribe", { operationId })
    return subscribeResult.completedOperation
  }

  let operation: OperationJson | undefined
  setHandler(getOperationCompletedSignal(operationId), _operation => {
    log.info("received operation completion signal", { operationId, status: _operation.status })
    operation = _operation
  })

  log.info("waiting for operation completion signal", { operationId })
  await condition(() => !!operation)

  return operation!
}

/**
 * Waits for an operation to complete successfully. If the operation fails, an error is thrown with the failure reason.
 *
 * @param operationId The ID of the operation to wait for.
 * @param subscribeToOperationCompletion The activity function used to subscribe to the operation completion.
 * @returns The final state of the operation after it has completed successfully.
 */
export async function waitForOperationSuccess(
  operationId: number,
  subscribeToOperationCompletion: OperationActivities["subscribeToOperationCompletion"],
): Promise<OperationJson> {
  const operation = await waitForOperation(operationId, subscribeToOperationCompletion)

  log.info("operation completed", { operationId, status: operation.status })

  if (operation.status === "OPERATION_STATUS_FAILED") {
    if (!operation.error) {
      throw new Error(`Operation ${operationId} failed with unknown error`)
    }

    throw new Error(`Operation ${operationId} failed with reason "${operation.error.reason}"`)
  }

  return operation
}

/**
 * Waits for an operation to complete successfully and extracts the result value from the operation resolution.
 *
 * @param operationId The ID of the operation to wait for.
 * @param subscribeToOperationCompletion The activity function used to subscribe to the operation completion.
 * @returns The result value from the operation resolution after it has completed successfully.
 */
export async function waitForOperationResult<T>(
  operationId: number,
  subscribeToOperationCompletion: OperationActivities["subscribeToOperationCompletion"],
): Promise<T> {
  const operation = await waitForOperationSuccess(operationId, subscribeToOperationCompletion)

  if (!operation.result) {
    throw new Error(`Operation ${operationId} completed without a result`)
  }

  return operation.result as T
}

export function getOperationCompletedSignal(operationId: number) {
  return defineSignal<[OperationJson]>(`operation:completed:${operationId}`)
}
