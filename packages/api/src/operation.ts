import {
  OperationStatus,
  type Operation,
  type OperationServiceClient,
} from "./_generated/common/operation.v1"

export type OperationWaitOptions = {
  /**
   * The operation service client to use for polling the operation status.
   */
  operationService: OperationServiceClient

  /**
   * The interval at which to poll the operation status, in milliseconds.
   * Defaults to 1000 ms (1 second).
   */
  interval?: number

  /**
   * The jitter to apply to the polling interval, in milliseconds.
   * Defaults to 200 ms. The actual polling interval will be a random value between `pollIntervalMs` and `pollIntervalMs + pollIntervalJitterMs`.
   * This helps to avoid thundering herd problems when multiple operations are being polled simultaneously.
   */
  jitter?: number

  /**
   * The timeout for waiting for the operation to complete, in milliseconds.
   * Defaults to -1 (no timeout).
   */
  timeout?: number
}

/**
 * Waits for an operation to resolve to a completed state (either success or failure) by polling its status at regular intervals.
 * If the polling itself fails the error is thrown (retry is expected to be configured in the provided `operationService` client),
 * but if the operation resolves to a failed state the error is returned as part of the response.
 *
 * @param operation The initial operation to wait for. If the operation is already completed, it is returned immediately.
 * @param options Options for polling the operation status.
 * @returns The final state of the operation after it has completed.
 * @throws If polling the operation status fails or if the timeout is reached before the operation completes.
 */
export async function waitForOperation(
  operation: Operation,
  options: OperationWaitOptions,
): Promise<Operation> {
  const interval = options.interval ?? 1000
  const jitter = options.jitter ?? 200
  const timeout = options.timeout ?? -1

  const startTime = Date.now()

  while (true) {
    if (
      operation.status === OperationStatus.COMPLETED ||
      operation.status === OperationStatus.FAILED
    ) {
      return operation
    }

    if (timeout >= 0 && Date.now() - startTime > timeout) {
      throw new Error("Operation wait timed out")
    }

    await Bun.sleep(interval + Math.floor(Math.random() * jitter))

    try {
      const response = await options.operationService.getOperation({
        operationId: operation.id,
      })

      if (!response.operation) {
        throw new Error(`Operation with ID "${operation.id}" not found`)
      }

      operation = response.operation
    } catch (error) {
      throw new Error(`Failed to poll status of operation "${operation.id}"`, { cause: error })
    }
  }
}

/**
 * Waits for an operation to complete successfully by polling its status at regular intervals.
 * If the operation resolves to a failed state, an error is thrown with the failure message.
 *
 * @param operation The initial operation to wait for. If the operation is already completed, it is returned immediately if successful, or an error is thrown if it has failed.
 * @param options Options for polling the operation status.
 * @returns The final state of the operation after it has completed successfully.
 * @throws If the operation fails or if polling the operation status fails or if the timeout is reached before the operation completes.
 */
export async function waitForOperationSuccess(
  operation: Operation,
  options: OperationWaitOptions,
): Promise<Operation> {
  const finalOperation = await waitForOperation(operation, options)

  if (finalOperation.status === OperationStatus.FAILED) {
    if (finalOperation.resolution?.$case !== "error") {
      throw new Error(`Operation "${operation.id}" failed with unknown error`)
    }

    throw new Error(
      `Operation "${operation.id}" failed with reason ${finalOperation.resolution?.value.reason} and message "${finalOperation.resolution?.value.metadata?.message}"`,
    )
  }

  return finalOperation
}

/**
 * Waits for some result value which can be either directly available or produced as the resolution of an operation.
 * This is a convenience function that combines `waitForOperationSuccess` with extracting the result value from the operation resolution.
 *
 * @template T The expected type of the result value.
 * @param result An object containing either the direct result value or an operation that will eventually resolve to the result.
 * @param options Options for polling the operation status if an operation is provided.
 * @returns The result value, either directly from the input or from the resolved operation.
 * @throws If the operation fails or if polling the operation status fails or if the timeout is reached before the operation completes.
 */
export async function waitForResult<T>(
  result: { $case: "operation"; value: Operation } | { $case: "result"; value: T },
  options: OperationWaitOptions,
): Promise<T> {
  if (result.$case === "result") {
    return result.value
  }

  const operation = await waitForOperationSuccess(result.value, options)

  if (operation.resolution?.$case !== "result") {
    throw new Error(`Operation "${operation.id}" completed without a result`)
  }

  return operation.resolution.value as T
}
