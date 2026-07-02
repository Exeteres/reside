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
  transactionsCommand,
  transferCommand,
} from "../definitions"
import { strings } from "../locale"
import { createServices } from "../shared"

const services = await createServices()
await runPrismaMigrations(services.pool)
await defineCommonResources({
  services,
  avatarTitle: strings.bootstrap.registration.title,
  commands: [balanceCommand, transactionsCommand, transferCommand],
  notificationsChannels: [
    {
      name: BankNotificationChannels.COMMAND,
      title: strings.notifications.channels.bank.title,
      description: strings.notifications.channels.bank.description,
    },
  ],
})
await bootstrapService()
await registerReplica({
  replica: bankReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})
