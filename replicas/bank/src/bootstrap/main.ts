import {
  bootstrapService,
  defineCommonResources,
  registerReplica,
  runPrismaMigrations,
} from "@reside/common"
import { bankReplica } from "@reside/registry"
import {
  BankNotificationChannels,
  balanceCommand,
  historyCommand,
  transferCommand,
} from "../definitions"
import { strings } from "../locale"
import { createServices } from "../shared"

await registerReplica({
  replica: bankReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})

const services = await createServices()

await runPrismaMigrations(services.pool)

await defineCommonResources({
  services,
  avatarTitle: strings.bootstrap.registration.title,
  commands: [balanceCommand, historyCommand, transferCommand],
  notificationsChannels: [
    {
      name: BankNotificationChannels.BANK,
      title: strings.notifications.channels.bank.title,
      description: strings.notifications.channels.bank.description,
    },
  ],
})

await bootstrapService()
