import { defineCommandHandler, sendNotification } from "@reside/common/workflow"
import { proxyActivities } from "@temporalio/workflow"
import { type ExampleActivities, ExampleNotificationChannels, exampleCommand } from "../definitions"
import { strings } from "../locale"

const { createExampleNote } = proxyActivities<ExampleActivities>({
  scheduleToCloseTimeout: "30 seconds",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
})

export const exampleCommandHandler = defineCommandHandler({
  command: exampleCommand,
  async handler({ params }) {
    try {
      const note = await createExampleNote({
        title: strings.commands.example.title,
        content: params.text ?? "Example command content",
        source: "command",
      })

      await sendNotification({
        channel: ExampleNotificationChannels.COMMAND,
        title: strings.notifications.example.success.title.replace("{id}", note.noteId),
        system: true,
      })
    } catch {
      await sendNotification({
        channel: ExampleNotificationChannels.COMMAND,
        title: strings.notifications.example.failure.title,
        system: true,
      })
    }
  },
})
