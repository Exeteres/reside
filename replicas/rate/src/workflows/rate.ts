import { defineCommandHandler, sendNotification } from "@reside/common/workflow"
import { proxyActivities } from "@temporalio/workflow"
import { type RateActivities, RateNotificationChannels, rateCommand } from "../definitions"
import { strings } from "../locale"

const { fetchKeyRate, updateChatTitleRate } = proxyActivities<RateActivities>({
  scheduleToCloseTimeout: "30 seconds",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
})

export const rateCommandHandler = defineCommandHandler({
  command: rateCommand,
  async handler({ context }) {
    try {
      const { rate } = await fetchKeyRate()
      const contextToken = context.context?.token

      if (contextToken) {
        await updateChatTitleRate({
          contextToken,
          rate,
        })
      }

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
