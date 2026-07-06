import { waitForOperationSuccess } from "@reside/api"
import {
  bootstrapGatewayRoute,
  bootstrapService,
  defineCommonResources,
  defineGateway,
  getReplicaCallbackEndpoint,
  registerReplica,
  runPrismaMigrations,
} from "@reside/common"
import { telegramReplica, WellKnownPermissions } from "@reside/registry"
import {
  TELEGRAM_GATEWAY_NAME,
  TELEGRAM_GATEWAY_ROUTE_NAME,
  TELEGRAM_WEBHOOK_PATH,
  TelegramNotificationChannels,
} from "../definitions"
import { strings } from "../locale"
import { createServices } from "../shared"

const services = await createServices()

await runPrismaMigrations(services.pool)

await defineCommonResources({
  services,

  realms: [
    {
      name: "telegram",
      title: "Telegram",
      description: strings.bootstrap.realmDescription,
      subjectServiceEndpoint: getReplicaCallbackEndpoint(),
    },
  ],

  permissions: [
    {
      name: WellKnownPermissions.TELEGRAM_COMMAND_MANAGE,
      title: strings.bootstrap.permissions.commandManage.title,
      description: strings.bootstrap.permissions.commandManage.description,
      scoped: true,
    },
    {
      name: WellKnownPermissions.TELEGRAM_COMMAND_INVOKE,
      title: strings.bootstrap.permissions.commandInvoke.title,
      description: strings.bootstrap.permissions.commandInvoke.description,
      scoped: true,
    },
    {
      name: WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_MANAGE,
      title: strings.bootstrap.permissions.notificationChannelManage.title,
      description: strings.bootstrap.permissions.notificationChannelManage.description,
      scoped: true,
    },
    {
      name: WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_INTERACT,
      title: strings.bootstrap.permissions.notificationChannelInteract.title,
      description: strings.bootstrap.permissions.notificationChannelInteract.description,
      scoped: true,
    },
    {
      name: WellKnownPermissions.TELEGRAM_NOTIFICATION_SEND_AS_SUBJECT,
      title: strings.bootstrap.permissions.notificationSendAsSubject.title,
      description: strings.bootstrap.permissions.notificationSendAsSubject.description,
      scoped: true,
    },
    {
      name: WellKnownPermissions.TELEGRAM_APPROVE,
      title: strings.bootstrap.permissions.approve.title,
      description: strings.bootstrap.permissions.approve.description,
      scoped: true,
    },
    {
      name: WellKnownPermissions.TELEGRAM_AVATAR_OWN,
      title: strings.bootstrap.permissions.avatarOwn.title,
      description: strings.bootstrap.permissions.avatarOwn.description,
      scoped: true,
    },
    {
      name: WellKnownPermissions.INTERACTION_NLS_ASK,
      title: strings.bootstrap.permissions.nlsAsk.title,
      description: strings.bootstrap.permissions.nlsAsk.description,
      scoped: true,
    },
    {
      name: WellKnownPermissions.INTERACTION_NLS_IMPERSONATE,
      title: strings.bootstrap.permissions.nlsImpersonate.title,
      description: strings.bootstrap.permissions.nlsImpersonate.description,
      scoped: true,
    },
    {
      name: WellKnownPermissions.INTERACTION_NLS_CLEAR_SUBJECT_CONTEXT,
      title: strings.bootstrap.permissions.nlsClearSubjectContext.title,
      description: strings.bootstrap.permissions.nlsClearSubjectContext.description,
      scoped: true,
    },
  ],
  reaperHandlers: [
    {
      resourceReplicaName: "telegram",
      title: strings.reaper.title,
    },
  ],
})

const { endpoint } = await defineGateway({
  services,

  name: TELEGRAM_GATEWAY_NAME,
  title: strings.bootstrap.gateway.title,
  description: strings.bootstrap.gateway.description,
})

await bootstrapGatewayRoute({
  gatewayName: TELEGRAM_GATEWAY_NAME,
  endpoint,
  routeName: TELEGRAM_GATEWAY_ROUTE_NAME,
  paths: [TELEGRAM_WEBHOOK_PATH],
})

await Promise.all([
  // create bootstrap channels directly since now have no telegram service
  services.prisma.notificationChannel.upsert({
    where: {
      name: TelegramNotificationChannels.AVATAR_PROVISIONING,
    },
    create: {
      name: TelegramNotificationChannels.AVATAR_PROVISIONING,
      title: strings.bootstrap.channels.avatarProvisioning.title,
      description: strings.bootstrap.channels.avatarProvisioning.description,
      ownerReplicaName: "telegram",
    },
    update: {
      title: strings.bootstrap.channels.avatarProvisioning.title,
      description: strings.bootstrap.channels.avatarProvisioning.description,
      ownerReplicaName: "telegram",
    },
  }),
  services.prisma.notificationChannel.upsert({
    where: {
      name: TelegramNotificationChannels.AVATAR_PRIVACY_MODE,
    },
    create: {
      name: TelegramNotificationChannels.AVATAR_PRIVACY_MODE,
      title: strings.bootstrap.channels.avatarPrivacyMode.title,
      description: strings.bootstrap.channels.avatarPrivacyMode.description,
      ownerReplicaName: "telegram",
    },
    update: {
      title: strings.bootstrap.channels.avatarPrivacyMode.title,
      description: strings.bootstrap.channels.avatarPrivacyMode.description,
      ownerReplicaName: "telegram",
    },
  }),
])

await backfillOwnerReplicaNames()

{
  const { operation } = await services.permissionRequestService.requestPermissions({
    reason: strings.bootstrap.nlsImpersonationReason,
    permissionSetName: "setup-language-subsystem",
    items: [
      {
        permissionName: WellKnownPermissions.INTERACTION_NLS_IMPERSONATE,
        scope: "telegram",
      },
      {
        permissionName: WellKnownPermissions.INTERACTION_NLS_CLEAR_SUBJECT_CONTEXT,
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

await bootstrapService({
  longRunning: true,
})

await registerReplica({
  replica: telegramReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})

async function backfillOwnerReplicaNames(): Promise<void> {
  const { replicas } = await services.replicaService.listReplicas({})
  const replicaNameByEndpoint = new Map<string, string>(
    replicas.map(replica => [`${replica.internalEndpoint}:80`, replica.name] as const),
  )

  const commands = await services.prisma.command.findMany({
    where: {
      ownerReplicaName: null,
    },
    select: {
      id: true,
      callbackEndpoint: true,
    },
  })

  await Promise.all(
    commands.map(async command => {
      const ownerReplicaName = replicaNameByEndpoint.get(command.callbackEndpoint)
      if (!ownerReplicaName) {
        return
      }

      await services.prisma.command.update({
        where: {
          id: command.id,
        },
        data: {
          ownerReplicaName,
        },
      })
    }),
  )

  await services.prisma.notificationChannel.updateMany({
    where: {
      ownerReplicaName: null,
      name: {
        startsWith: "telegram:",
      },
    },
    data: {
      ownerReplicaName: "telegram",
    },
  })
}
