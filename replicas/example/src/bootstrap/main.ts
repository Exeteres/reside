import {
  bootstrapService,
  defineCommonResources,
  registerReplica,
  runPrismaMigrations,
} from "@reside/common"
import { exampleReplica } from "@reside/registry"
import { ExampleNotificationChannels, exampleCommand } from "../definitions"
import { strings } from "../locale"
import { createServices } from "../shared"

const services = await createServices()

await runPrismaMigrations(services.pool)

await defineCommonResources({
  services,
  avatarTitle: strings.bootstrap.registration.title,
  commands: [exampleCommand],
  notificationsChannels: [
    {
      name: ExampleNotificationChannels.COMMAND,
      title: strings.notifications.channels.example.title,
      description: strings.notifications.channels.example.description,
    },
  ],
})

await bootstrapService()

await registerReplica({
  replica: exampleReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})
