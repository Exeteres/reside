import { defineCommandHandler, sendNotification } from "@reside/common/workflow"
import { proxyActivities } from "@temporalio/workflow"
import { type AiActivities, AiNotificationChannels, imageCommand } from "../definitions"
import { strings } from "../locale"

const { createAiImage } = proxyActivities<AiActivities>({
  scheduleToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
})

export const imageCommandHandler = defineCommandHandler({
  command: imageCommand,
  async handler({ params }) {
    try {
      const image = await createAiImage({
        size: params.size,
        prompt: params.prompt,
      })

      await sendNotification({
        channel: AiNotificationChannels.COMMAND,
        title: strings.notifications.ai.success.title,
        imageUrls: [image.url],
        system: true,
      })
    } catch {
      await sendNotification({
        channel: AiNotificationChannels.COMMAND,
        title: strings.notifications.ai.failure.title,
        system: true,
      })
    }
  },
})
