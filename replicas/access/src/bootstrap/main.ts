import { bootstrapService, runPrismaMigrations, WellKnownPermissions } from "@reside/common"
import { strings } from "../locale"
import { createServices } from "../shared"

const { pool, prisma } = await createServices()

await runPrismaMigrations(pool)

const [
  //
  _,
  realmManagePermission,
  permissionManagePermission,
  approverManagePermission,
  subjectReadPermission,
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

  // define permissions for telegram replica to allow it to bootstrap
  // it will fill title/description later when it starts
  ensurePermission(WellKnownPermissions.TELEGRAM_APPROVE, "", "", true),
  ensurePermission(WellKnownPermissions.TELEGRAM_COMMAND_MANAGE, "", "", true),
  ensurePermission(WellKnownPermissions.TELEGRAM_COMMAND_INVOKE, "", "", true),
  ensurePermission(WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_MANAGE, "", "", true),
  ensurePermission(WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_INTERACT, "", "", true),
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
])

await bootstrapService({ longRunning: true })

function ensurePermission(name: string, title: string, description: string, scoped: boolean) {
  return prisma.permission.upsert({
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
  return prisma.permissionBinding.upsert({
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
  return prisma.realm.upsert({
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
