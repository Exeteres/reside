import type { TimerServiceClient } from "@reside/api/infra/timer.v1"
import { getReplicaEndpoint } from "../kubernetes"

export type SetSleepTimerRequest = {
  delayMs: number
}

export function createSleepActivities(timerService: TimerServiceClient) {
  return {
    async setSleepTimer(request: SetSleepTimerRequest): Promise<void> {
      if (request.delayMs <= 0) {
        return
      }

      await timerService.setTimer({
        callbackEndpoint: `${getReplicaEndpoint()}:80`,
        delayMs: BigInt(request.delayMs),
      })
    },
  }
}

export type SleepActivities = ReturnType<typeof createSleepActivities>
