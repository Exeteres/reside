import { defineCommandHandler, sendNotification } from "@reside/common/workflow"
import { proxyActivities } from "@temporalio/workflow"
import { RateNotificationChannels, rateCommand } from "../definitions"
import { strings } from "../locale"

const { fetchKeyRate } = proxyActivities<{
  fetchKeyRate: () => Promise<number>
}>({
  scheduleToCloseTimeout: "30 seconds",
  retry: {
    maximumAttempts: 3,
    initialInterval: "2 seconds",
  },
})

export const rateCommandHandler = defineCommandHandler({
  command: rateCommand,
  async handler() {
    let rate: number

    try {
      rate = await fetchKeyRate()
    } catch {
      await sendNotification({
        channel: RateNotificationChannels.RATE,
        title: strings.notifications.rate.errorTitle,
      })
      return
    }

    await sendNotification({
      channel: RateNotificationChannels.RATE,
      title: strings.notifications.rate.title(rate),
    })
  },
})
