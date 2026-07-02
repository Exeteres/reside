import {
  bootstrapService,
  defineCommonResources,
  ensureReplicaAvatar,
  registerReplica,
  runPrismaMigrations,
} from "@reside/common"
import { accessReplica, WellKnownPermissions } from "@reside/registry"
import { strings } from "../locale"
import { createServices } from "../shared"

await registerReplica({
  replica: accessReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})

const services = await createServices()

await runPrismaMigrations(services.pool)

const [
  //
  _,
  realmManagePermission,
  permissionManagePermission,
  approverManagePermission,
  subjectReadPermission,
  ,
  infraGatewayManagePermission,
  avatarOwnPermission,
  sendAsSubjectPermission,
  interactionNlsImpersonatePermission,
  ,
  interactionNlsClearSubjectContextPermission,
  reaperHandlerRegisterPermission,
] = await Promise.all([
  ensureRealm("replica"),
  ensurePermission(
    WellKnownPermissions.ACCESS_REALM_MANAGE,
    strings.bootstrap.permissions.realmManage.title,
    strings.bootstrap.permissions.realmManage.description,
    true,
  ),
  ensurePermission(
    WellKnownPermissions.ACCESS_PERMISSION_MANAGE,
    strings.bootstrap.permissions.permissionManage.title,
    strings.bootstrap.permissions.permissionManage.description,
    true,
  ),
  ensurePermission(
    WellKnownPermissions.ACCESS_APPROVER_MANAGE,
    strings.bootstrap.permissions.approverManage.title,
    strings.bootstrap.permissions.approverManage.description,
    true,
  ),
  ensurePermission(
    WellKnownPermissions.ACCESS_SUBJECT_READ,
    strings.bootstrap.permissions.subjectRead.title,
    strings.bootstrap.permissions.subjectRead.description,
    true,
  ),
  ensurePermission(
    WellKnownPermissions.ENCRYPTION_TRANSFER,
    strings.bootstrap.permissions.encryptionTransfer.title,
    strings.bootstrap.permissions.encryptionTransfer.description,
    true,
  ),

  // define permissions for telegram and infra replica to allow them to bootstrap
  // they will fill title/description later when they (re)starts
  ensurePermission(WellKnownPermissions.INFRA_GATEWAY_MANAGE, "", "", true),

  ensurePermission(WellKnownPermissions.TELEGRAM_AVATAR_OWN, "", "", true),
  ensurePermission(WellKnownPermissions.TELEGRAM_NOTIFICATION_SEND_AS_SUBJECT, "", "", true),
  ensurePermission(WellKnownPermissions.INTERACTION_NLS_IMPERSONATE, "", "", true),
  ensurePermission(WellKnownPermissions.INTERACTION_NLS_ASK, "", "", true),
  ensurePermission(WellKnownPermissions.INTERACTION_NLS_CLEAR_SUBJECT_CONTEXT, "", "", true),
  ensurePermission(WellKnownPermissions.TELEGRAM_APPROVE, "", "", true),
  ensurePermission(WellKnownPermissions.TELEGRAM_COMMAND_MANAGE, "", "", true),
  ensurePermission(WellKnownPermissions.TELEGRAM_COMMAND_INVOKE, "", "", true),
  ensurePermission(WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_MANAGE, "", "", true),
  ensurePermission(WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_INTERACT, "", "", true),
  ensurePermission(WellKnownPermissions.REAPER_HANDLER_REGISTER, "", "", true),
])

await Promise.all([
  // add static bindigs for telegram replica to setup approval infrastructure
  ensureBinding(realmManagePermission.id, "replica:telegram", "telegram"),
  ensureBinding(approverManagePermission.id, "replica:telegram", "telegram:50:replica:telegram"),
  ensureBinding(subjectReadPermission.id, "replica:telegram", "replica"),

  ensureBinding(
    permissionManagePermission.id,
    "replica:telegram",
    WellKnownPermissions.TELEGRAM_COMMAND_MANAGE,
  ),

  ensureBinding(
    permissionManagePermission.id,
    "replica:telegram",
    WellKnownPermissions.TELEGRAM_COMMAND_INVOKE,
  ),

  ensureBinding(
    permissionManagePermission.id,
    "replica:telegram",
    WellKnownPermissions.TELEGRAM_APPROVE,
  ),

  ensureBinding(
    permissionManagePermission.id,
    "replica:telegram",
    WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_MANAGE,
  ),

  ensureBinding(
    permissionManagePermission.id,
    "replica:telegram",
    WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_INTERACT,
  ),

  ensureBinding(
    permissionManagePermission.id,
    "replica:telegram",
    WellKnownPermissions.TELEGRAM_NOTIFICATION_SEND_AS_SUBJECT,
  ),

  ensureBinding(
    permissionManagePermission.id,
    "replica:telegram",
    WellKnownPermissions.TELEGRAM_AVATAR_OWN,
  ),

  ensureBinding(
    permissionManagePermission.id,
    "replica:reaper",
    WellKnownPermissions.REAPER_HANDLER_REGISTER,
  ),

  ensureBinding(
    permissionManagePermission.id,
    "replica:telegram",
    WellKnownPermissions.INTERACTION_NLS_ASK,
  ),

  ensureBinding(
    permissionManagePermission.id,
    "replica:telegram",
    WellKnownPermissions.INTERACTION_NLS_IMPERSONATE,
  ),

  ensureBinding(
    permissionManagePermission.id,
    "replica:telegram",
    WellKnownPermissions.INTERACTION_NLS_CLEAR_SUBJECT_CONTEXT,
  ),

  ensureBinding(
    permissionManagePermission.id,
    "replica:infra",
    WellKnownPermissions.INFRA_GATEWAY_MANAGE,
  ),

  // to allow auth requests on behalf of access replica
  ensureBinding(sendAsSubjectPermission.id, "replica:telegram", "replica:access"),

  // to allow telegram and access replicas have avatars
  ensureBinding(avatarOwnPermission.id, "replica:telegram", "telegram"),
  ensureBinding(avatarOwnPermission.id, "replica:access", "access"),

  // to allow telegram replica create gateway for itself
  ensureBinding(infraGatewayManagePermission.id, "replica:telegram", "telegram"),

  // to allow reaper replica to register cleanup handlers for itself if needed
  ensureBinding(reaperHandlerRegisterPermission.id, "replica:reaper", "reaper"),

  // to allow users query NLS of other replicas via telegram replica
  ensureBinding(interactionNlsImpersonatePermission.id, "replica:telegram", "telegram"),

  // to allow users clear their NLS context of other replicas via telegram replica
  ensureBinding(interactionNlsClearSubjectContextPermission.id, "replica:telegram", "telegram"),
])

await ensureReplicaAvatar({
  avatarService: services.avatarService,
  operationService: services.interactionOperationService,
  avatarTitle: strings.bootstrap.registration.title,
})

await backfillApproverOwners()

await defineCommonResources({
  services,
  reaperHandlers: [
    {
      resourceReplicaName: "access",
      title: strings.reaper.title,
    },
  ],
})

await bootstrapService({ longRunning: true })

async function backfillApproverOwners(): Promise<void> {
  const { replicas } = await services.replicaService.listReplicas({})
  const replicaNameByEndpoint = new Map<string, string>(
    replicas.map(replica => [`${replica.internalEndpoint}:80`, replica.name] as const),
  )

  const approvers = await services.prisma.approver.findMany({
    where: {
      ownerReplicaName: null,
    },
    select: {
      id: true,
      callbackEndpoint: true,
    },
  })

  await Promise.all(
    approvers.map(async approver => {
      const ownerReplicaName = replicaNameByEndpoint.get(approver.callbackEndpoint)
      if (!ownerReplicaName) {
        return
      }

      await services.prisma.approver.update({
        where: {
          id: approver.id,
        },
        data: {
          ownerReplicaName,
        },
      })
    }),
  )
}

function ensurePermission(name: string, title: string, description: string, scoped: boolean) {
  return services.prisma.permission.upsert({
    where: {
      name,
    },
    create: {
      name,
      title,
      description,
      scoped,
    },
    update: {
      title,
      description,
      scoped,
    },
  })
}

function ensureBinding(permissionId: number, subjectId: string, scope: string = "") {
  return services.prisma.permissionBinding.upsert({
    where: {
      permissionId_subjectId_scope: {
        permissionId,
        subjectId,
        scope,
      },
    },
    create: {
      permissionId,
      subjectId,
      scope,
    },
    update: {},
  })
}

function ensureRealm(name: string) {
  return services.prisma.realm.upsert({
    where: {
      name,
    },
    create: {
      name,
      title: name,
    },
    update: {
      title: name,
    },
  })
}
