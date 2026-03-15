import { defineCommandHandler, sendNotification } from "@reside/common/workflow"
import { log } from "@temporalio/workflow"
import { AlphaNotificationChannels, helloCommand } from "../definitions"

export const helloCommandHandler = defineCommandHandler({
  command: helloCommand,
  async handler({ params }) {
    log.info(`received hello command with params`, { params })

    await sendNotification({
      title: `Hello, ${params.name}!`,
      channel: AlphaNotificationChannels.HELLO,
    })
  },
})
