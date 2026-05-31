import type { SetTimerRequest } from "@reside/api/infra/timer.v1"
import { Code, ConnectError } from "@connectrpc/connect"

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

export const parseTimerDelayMs = parseDelayMs
