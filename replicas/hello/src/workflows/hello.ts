import { defineCommandHandler, sendNotification } from "@reside/common/workflow"
import { HelloNotificationChannels, helloCommand } from "../definitions"

export const helloCommandHandler = defineCommandHandler({
  command: helloCommand,
  async handler() {
    await sendNotification({
      title: "hi",
      channel: HelloNotificationChannels.HELLO,
    })
  },
})
