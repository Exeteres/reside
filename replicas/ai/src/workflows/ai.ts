import { NotificationStatus } from "@reside/api/interaction/notification.v1"
import {
  block,
  defineCommandHandler,
  safeSleep,
  sendNotification,
  updateNotification,
} from "@reside/common/workflow"
import { proxyActivities } from "@temporalio/workflow"
import {
  type AiActivities,
  AiNotificationChannels,
  type CreateAiImageInput,
  type CreateAiImageOutput,
  imageCommand,
} from "../definitions"
import { strings } from "../locale"

const { createAiImage } = proxyActivities<AiActivities>({
  scheduleToCloseTimeout: "10 minutes",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
})

const IMAGE_GENERATION_KEEPALIVE_INTERVAL_MS = 20_000

export const imageCommandHandler = defineCommandHandler({
  command: imageCommand,
  async handler({ params }) {
    const progressNotification = await sendNotification({
      channel: AiNotificationChannels.COMMAND,
      title: strings.notifications.ai.progress.title,
      message: block(strings.notifications.ai.progress.message),
      status: NotificationStatus.IN_PROGRESS,
      system: true,
      waitForResponse: false,
    })

    try {
      const image = await createAiImageWithKeepAlive({
        size: params.size,
        prompt: params.prompt,
      })

      await updateNotification({
        notificationId: progressNotification.notificationId,
        title: strings.notifications.ai.success.title,
        content: block(strings.notifications.ai.success.message),
        status: NotificationStatus.COMPLETED,
        imageUrls: [image.url],
      })
    } catch {
      await updateNotification({
        notificationId: progressNotification.notificationId,
        title: strings.notifications.ai.failure.title,
        content: block(strings.notifications.ai.failure.message),
        status: NotificationStatus.FAILED,
      })
    }
  },
})

async function createAiImageWithKeepAlive(input: CreateAiImageInput): Promise<CreateAiImageOutput> {
  const imagePromise = createAiImage(input)

  while (true) {
    const result = await Promise.race([
      imagePromise.then(image => ({ type: "image" as const, image })),
      safeSleep(IMAGE_GENERATION_KEEPALIVE_INTERVAL_MS).then(() => ({
        type: "keepalive" as const,
      })),
    ])

    if (result.type === "image") {
      return result.image
    }
  }
}
