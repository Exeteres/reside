import { bootstrapService, defineCommonResources, registerReplica } from "@reside/common"
import { notcompelReplica } from "@reside/registry"
import { NotcompelNotificationChannels, notcompelCommand } from "../definitions"
import { strings } from "../locale"
import { createServices } from "../shared"
import { bootstrapNotcompelCronJob } from "./cron"

await registerReplica({
  replica: notcompelReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})

const services = await createServices()

await defineCommonResources({
  services,
  avatarTitle: strings.bootstrap.registration.title,
  commands: [notcompelCommand],
  notificationsChannels: [
    {
      name: NotcompelNotificationChannels.IMAGE,
      title: strings.notifications.channels.notcompel.title,
      description: strings.notifications.channels.notcompel.description,
    },
  ],
})

await bootstrapService()
await bootstrapNotcompelCronJob()
