import {
  bootstrapService,
  defineCommonResources,
  registerReplica,
  runPrismaMigrations,
} from "@reside/common"
import { casinoReplica } from "@reside/registry"
import { betCommand, CasinoNotificationChannels } from "../definitions"
import { strings } from "../locale"
import { createServices } from "../shared"

const services = await createServices()

await runPrismaMigrations(services.pool)

await defineCommonResources({
  services,
  avatarTitle: strings.bootstrap.registration.title,
  commands: [betCommand],
  notificationsChannels: [
    {
      name: CasinoNotificationChannels.COMMAND,
      title: strings.notifications.channels.casino.title,
      description: strings.notifications.channels.casino.description,
    },
  ],
})

await bootstrapService()

await registerReplica({
  replica: casinoReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})
