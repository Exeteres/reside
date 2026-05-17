import type { SetTimerRequest, TimerServiceImplementation } from "@reside/api/infra/timer.v1"
import type { Client } from "@temporalio/client"
import { randomUUID } from "node:crypto"
import { Code, ConnectError } from "@connectrpc/connect"
import { authenticateReplica, DEFAULT_TEMPORAL_TASK_QUEUE, logger } from "@reside/common"

const WAKE_REPLICA_WORKFLOW_TYPE = "wakeReplicaAfterTimerWorkflow"

export function createTimerService({
  temporalClient,
}: {
  temporalClient: Client
}): TimerServiceImplementation {
  return {
    async setTimer(request, context) {
      await authenticateReplica(context)

      const callbackEndpoint = request.callbackEndpoint.trim()
      if (callbackEndpoint.length === 0) {
        throw new ConnectError("callbackEndpoint must not be empty", Code.InvalidArgument)
      }

      const delayMs = parseDelayMs(request)

      await temporalClient.workflow.start(WAKE_REPLICA_WORKFLOW_TYPE, {
        workflowId: `wake-endpoint-${randomUUID()}`,
        taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
        args: [
          {
            callbackEndpoint,
            delayMs,
          },
        ],
      })

      logger.info(
        "scheduled wake-up timer workflow for callback endpoint %s with delay %dms",
        callbackEndpoint,
        delayMs,
      )

      return {}
    },
  }
}

function parseDelayMs(request: SetTimerRequest): number {
  let delayMsBigInt: bigint

  try {
    delayMsBigInt = BigInt(request.delayMs)
  } catch {
    throw new ConnectError("delayMs must be a valid integer", Code.InvalidArgument)
  }

  if (delayMsBigInt <= 0n) {
    throw new ConnectError("delayMs must be greater than zero", Code.InvalidArgument)
  }

  if (delayMsBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ConnectError("delayMs exceeds supported range", Code.InvalidArgument)
  }

  return Number(delayMsBigInt)
}
