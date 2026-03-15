import {
  bootstrapService,
  defineCommonResources,
  getReplicaEndpoint,
  registerReplica,
  runPrismaMigrations,
  WellKnownPermissions,
} from "@reside/common"
import { telegramReplica } from "@reside/topology"
import { TelegramNotificationChannels } from "../definitions"
import { strings } from "../locale"
import { createServices } from "../shared"

await registerReplica({
  replica: telegramReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})

const { pool, prisma, accessRequestService, accessOperationService, accessDefinitionService } =
  await createServices()

await runPrismaMigrations(pool)

const interactionContextCount = await prisma.interactionContext.count()
if (interactionContextCount === 0) {
  // ensure system interaction context exists for system-initiated interactions (e.g. approval callbacks)
  await prisma.interactionContext.create({
    data: {
      type: "SYSTEM",
      chatId: null,
      userId: null,
    },
  })
}

await defineCommonResources({
  accessRequestService,
  accessOperationService,
  access: {
    definitionService: accessDefinitionService,
    realms: [
      {
        name: "telegram",
        title: "Telegram",
        description: strings.bootstrap.realmDescription,
        subjectServiceEndpoint: `${getReplicaEndpoint()}:80`,
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
    ],
  },
})

// create approval channel directly since now have no telegram service
await prisma.notificationChannel.upsert({
  where: {
    name: TelegramNotificationChannels.APPROVAL,
  },
  create: {
    name: TelegramNotificationChannels.APPROVAL,
    title: strings.bootstrap.channels.approvals.title,
    description: strings.bootstrap.channels.approvals.description,
  },
  update: {
    title: strings.bootstrap.channels.approvals.title,
    description: strings.bootstrap.channels.approvals.description,
  },
})

await accessDefinitionService.putApprover({
  name: "telegram",
  priority: 50,
  realms: ["telegram", "replica"],
  title: strings.bootstrap.approver.title,
  description: strings.bootstrap.approver.description,
  callbackEndpoint: `${telegramReplica.endpoint}:80`,
})

await bootstrapService({ longRunning: true })
