import {
  bootstrapService,
  defineCommonResources,
  registerReplica,
  runPrismaMigrations,
} from "@reside/common"
import { bankReplica, WellKnownPermissions } from "@reside/registry"
import {
  BankNotificationChannels,
  balanceCommand,
  issueReplicaFundsCommand,
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
  commands: [balanceCommand, transactionsCommand, transferCommand, issueReplicaFundsCommand],
  permissions: [
    {
      name: WellKnownPermissions.BANK_ISSUE_REPLICA_FUNDS,
      title: "Выпуск средств репликам",
      description: "Позволяет увеличивать баланс любой реплики в банковской реплике.",
      scoped: false,
    },
    {
      name: WellKnownPermissions.BANK_REQUEST_PAYMENTS,
      title: "Запрос платежей",
      description: "Позволяет реплике запрашивать оплату у пользователей в рамках реалма.",
      scoped: true,
    },
  ],
  notificationsChannels: [
    {
      name: BankNotificationChannels.COMMAND,
      title: strings.notifications.channels.bank.title,
      description: strings.notifications.channels.bank.description,
    },
    {
      name: BankNotificationChannels.PAYMENT_REQUESTS,
      title: strings.notifications.channels.paymentRequests.title,
      description: strings.notifications.channels.paymentRequests.description,
    },
  ],
})

await bootstrapService()

await registerReplica({
  replica: bankReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})
