import {
  bootstrapService,
  defineCommonResources,
  registerReplica,
  runPrismaMigrations,
} from "@reside/common"
import { aiReplica } from "@reside/registry"
import { AiNotificationChannels, imageCommand } from "../definitions"
import { strings } from "../locale"
import { createServices } from "../shared"

const services = await createServices()

await runPrismaMigrations(services.pool)

await defineCommonResources({
  services,
  avatarTitle: strings.bootstrap.registration.title,
  commands: [imageCommand],
  notificationsChannels: [
    {
      name: AiNotificationChannels.COMMAND,
      title: strings.notifications.channels.ai.title,
      description: strings.notifications.channels.ai.description,
    },
  ],
})

await bootstrapService()

await registerReplica({
  replica: aiReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})
