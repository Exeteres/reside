import { bootstrapService, defineCommonResources, registerReplica } from "@reside/common"
import { helloReplica } from "@reside/registry"
import { HelloNotificationChannels, helloCommand } from "../definitions"
import { strings } from "../locale"
import { createServices } from "../shared"

await registerReplica({
  replica: helloReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})

const services = await createServices()

await defineCommonResources({
  services,
  avatarTitle: strings.bootstrap.registration.title,
  commands: [helloCommand],
  notificationsChannels: [
    {
      name: HelloNotificationChannels.HELLO,
      title: strings.notifications.channels.hello.title,
      description: strings.notifications.channels.hello.description,
    },
  ],
})

await bootstrapService({ longRunning: true })
