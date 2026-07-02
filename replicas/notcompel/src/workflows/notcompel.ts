import { defineCommandHandler } from "@reside/common/workflow"
import { proxyActivities } from "@temporalio/workflow"
import { type NotcompelActivities, notcompelCommand } from "../definitions"

const { sendNotcompelImage } = proxyActivities<NotcompelActivities>({
  scheduleToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
})

export const notcompelCommandHandler = defineCommandHandler({
  command: notcompelCommand,
  async handler() {
    await sendNotcompelImage()
  },
})
