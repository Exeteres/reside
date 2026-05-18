import { defineCommandHandler, sendNotification } from "@reside/common/workflow"
import { proxyActivities } from "@temporalio/workflow"
import { RateNotificationChannels, rateCommand } from "../definitions"
import { strings } from "../locale"

const { fetchKeyRate } = proxyActivities<{
  fetchKeyRate: () => Promise<number>
}>({
  scheduleToCloseTimeout: "30 seconds",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
})

export const rateCommandHandler = defineCommandHandler({
  command: rateCommand,
  async handler() {
    try {
      const rate = await fetchKeyRate()

      await sendNotification({
        channel: RateNotificationChannels.RATE,
        title: strings.notifications.rate.success.title.replace("{value}", `${rate}`),
      })
    } catch {
      await sendNotification({
        channel: RateNotificationChannels.RATE,
        title: strings.notifications.rate.failure.title,
      })
    }
  },
})
