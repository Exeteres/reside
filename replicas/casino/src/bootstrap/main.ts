import { waitForOperationSuccess } from "@reside/api"
import {
  bootstrapService,
  defineCommonResources,
  registerReplica,
  runPrismaMigrations,
} from "@reside/common"
import { casinoReplica, WellKnownPermissions } from "@reside/registry"
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

{
  const { operation } = await services.permissionRequestService.requestPermissions({
    reason: strings.bootstrap.bankPaymentRequestReason,
    permissionSetName: "casino-bank-payment-requests",
    items: [
      {
        permissionName: WellKnownPermissions.BANK_REQUEST_PAYMENTS,
        scope: "telegram",
      },
    ],
  })

  if (operation) {
    await waitForOperationSuccess(operation, {
      operationService: services.accessOperationService,
    })
  }
}

await bootstrapService()

await registerReplica({
  replica: casinoReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})
