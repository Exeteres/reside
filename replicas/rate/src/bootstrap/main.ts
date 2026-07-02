import {
  bootstrapService,
  defineCommonResources,
  registerReplica,
  runPrismaMigrations,
} from "@reside/common"
import { rateReplica } from "@reside/registry"
import { RateNotificationChannels, rateCommand } from "../definitions"
import { strings } from "../locale"
import { createServices } from "../shared"

const services = await createServices()

await runPrismaMigrations(services.pool)

await defineCommonResources({
  services,
  avatarTitle: strings.bootstrap.registration.title,
  commands: [rateCommand],
  notificationsChannels: [
    {
      name: RateNotificationChannels.RATE,
      title: strings.notifications.channels.rate.title,
      description: strings.notifications.channels.rate.description,
    },
  ],
})

await bootstrapService()

await registerReplica({
  replica: rateReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})
