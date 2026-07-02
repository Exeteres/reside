import {
  bootstrapService,
  defineCommonResources,
  registerReplica,
  runPrismaMigrations,
} from "@reside/common"
import { reaperReplica, WellKnownPermissions } from "@reside/registry"
import { killCommand, ReaperNotificationChannels } from "../definitions"
import { strings } from "../locale"
import { createServices } from "../shared"

const services = await createServices()

await runPrismaMigrations(services.pool)

await defineCommonResources({
  services,
  avatarTitle: strings.bootstrap.registration.title,
  permissions: [
    {
      name: WellKnownPermissions.REAPER_HANDLER_REGISTER,
      title: strings.bootstrap.permissions.handlerRegister.title,
      description: strings.bootstrap.permissions.handlerRegister.description,
      scoped: true,
    },
  ],
  commands: [killCommand],
  notificationsChannels: [
    {
      name: ReaperNotificationChannels.COMMAND,
      title: strings.notifications.channels.command.title,
      description: strings.notifications.channels.command.description,
    },
  ],
})

await bootstrapService()

await registerReplica({
  replica: reaperReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})
