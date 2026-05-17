import type { SleepActivities } from "../temporal"
import { proxyActivities, sleep } from "@temporalio/workflow"

const { setSleepTimer } = proxyActivities<Pick<SleepActivities, "setSleepTimer">>({
  startToCloseTimeout: "1 minute",
  scheduleToCloseTimeout: "10 minutes",
  retry: {
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
  },
})

/**
 * Schedules a wake-up timer through infra before entering workflow sleep.
 *
 * @param delayMs The sleep duration in milliseconds.
 */
export async function sleepSafely(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return
  }

  await setSleepTimer({
    delayMs,
  })

  await sleep(delayMs)
}
