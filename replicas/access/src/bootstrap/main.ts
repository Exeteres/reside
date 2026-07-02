import type { Permission } from "../database"
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

type EnsurePermissionInput = {
  name: string
  title?: string
  description?: string
  scoped: boolean
}

type PermissionDefinitions = Record<string, EnsurePermissionInput>

type PermissionDefinitionKey<TDefinitions extends PermissionDefinitions> = Extract<
  keyof TDefinitions,
  string
>

type EnsuredPermissions<TDefinitions extends PermissionDefinitions> = {
  [TName in keyof TDefinitions]: Permission
}

type StaticPermissionBinding = {
  permission: Permission
  subjectId: string
  scope?: string
}

const ACCESS_SUBJECT_ID = "replica:access"
const INFRA_SUBJECT_ID = "replica:infra"
const REAPER_SUBJECT_ID = "replica:reaper"
const TELEGRAM_SUBJECT_ID = "replica:telegram"

const services = await createServices()

await runPrismaMigrations(services.pool)

const replicaRealmPromise = ensureRealm("replica")
const permissions = await ensurePermissions({
  accessRealmManage: {
    name: WellKnownPermissions.ACCESS_REALM_MANAGE,
    title: strings.bootstrap.permissions.realmManage.title,
    description: strings.bootstrap.permissions.realmManage.description,
    scoped: true,
  },
  accessPermissionManage: {
    name: WellKnownPermissions.ACCESS_PERMISSION_MANAGE,
    title: strings.bootstrap.permissions.permissionManage.title,
    description: strings.bootstrap.permissions.permissionManage.description,
    scoped: true,
  },
  accessApproverManage: {
    name: WellKnownPermissions.ACCESS_APPROVER_MANAGE,
    title: strings.bootstrap.permissions.approverManage.title,
    description: strings.bootstrap.permissions.approverManage.description,
    scoped: true,
  },
  accessSubjectRead: {
    name: WellKnownPermissions.ACCESS_SUBJECT_READ,
    title: strings.bootstrap.permissions.subjectRead.title,
    description: strings.bootstrap.permissions.subjectRead.description,
    scoped: true,
  },
  encryptionTransfer: {
    name: WellKnownPermissions.ENCRYPTION_TRANSFER,
    title: strings.bootstrap.permissions.encryptionTransfer.title,
    description: strings.bootstrap.permissions.encryptionTransfer.description,
    scoped: true,
  },

  // These permissions are created here so static bootstrap bindings can be inserted
  // before the owning replicas have updated titles and descriptions.
  infraGatewayManage: {
    name: WellKnownPermissions.INFRA_GATEWAY_MANAGE,
    scoped: true,
  },
  telegramAvatarOwn: {
    name: WellKnownPermissions.TELEGRAM_AVATAR_OWN,
    scoped: true,
  },
  telegramNotificationSendAsSubject: {
    name: WellKnownPermissions.TELEGRAM_NOTIFICATION_SEND_AS_SUBJECT,
    scoped: true,
  },
  interactionNlsImpersonate: {
    name: WellKnownPermissions.INTERACTION_NLS_IMPERSONATE,
    scoped: true,
  },
  interactionNlsAsk: {
    name: WellKnownPermissions.INTERACTION_NLS_ASK,
    scoped: true,
  },
  interactionNlsClearSubjectContext: {
    name: WellKnownPermissions.INTERACTION_NLS_CLEAR_SUBJECT_CONTEXT,
    scoped: true,
  },
  telegramApprove: {
    name: WellKnownPermissions.TELEGRAM_APPROVE,
    scoped: true,
  },
  telegramCommandManage: {
    name: WellKnownPermissions.TELEGRAM_COMMAND_MANAGE,
    scoped: true,
  },
  telegramCommandInvoke: {
    name: WellKnownPermissions.TELEGRAM_COMMAND_INVOKE,
    scoped: true,
  },
  telegramNotificationChannelManage: {
    name: WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_MANAGE,
    scoped: true,
  },
  telegramNotificationChannelInteract: {
    name: WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_INTERACT,
    scoped: true,
  },
  reaperHandlerRegister: {
    name: WellKnownPermissions.REAPER_HANDLER_REGISTER,
    scoped: true,
  },
})

await replicaRealmPromise

await ensureStaticBindings([
  // Static permissions required by Access Replica bootstrap.
  { permission: permissions.telegramAvatarOwn, subjectId: ACCESS_SUBJECT_ID, scope: "access" },
  { permission: permissions.reaperHandlerRegister, subjectId: ACCESS_SUBJECT_ID, scope: "access" },

  // Static permissions required by Infra Replica bootstrap.
  {
    permission: permissions.accessPermissionManage,
    subjectId: INFRA_SUBJECT_ID,
    scope: WellKnownPermissions.INFRA_GATEWAY_MANAGE,
  },
  {
    permission: permissions.accessPermissionManage,
    subjectId: INFRA_SUBJECT_ID,
    scope: WellKnownPermissions.INFRA_TEMPORARY_POSTGRES_DATABASE_CREATE,
  },
  { permission: permissions.reaperHandlerRegister, subjectId: INFRA_SUBJECT_ID, scope: "infra" },

  // Static permissions required by Telegram Replica bootstrap.
  { permission: permissions.accessRealmManage, subjectId: TELEGRAM_SUBJECT_ID, scope: "telegram" },
  {
    permission: permissions.accessApproverManage,
    subjectId: TELEGRAM_SUBJECT_ID,
    scope: "telegram:50:replica:telegram",
  },
  { permission: permissions.accessSubjectRead, subjectId: TELEGRAM_SUBJECT_ID, scope: "replica" },
  {
    permission: permissions.accessPermissionManage,
    subjectId: TELEGRAM_SUBJECT_ID,
    scope: WellKnownPermissions.TELEGRAM_COMMAND_MANAGE,
  },
  {
    permission: permissions.accessPermissionManage,
    subjectId: TELEGRAM_SUBJECT_ID,
    scope: WellKnownPermissions.TELEGRAM_COMMAND_INVOKE,
  },
  {
    permission: permissions.accessPermissionManage,
    subjectId: TELEGRAM_SUBJECT_ID,
    scope: WellKnownPermissions.TELEGRAM_APPROVE,
  },
  {
    permission: permissions.accessPermissionManage,
    subjectId: TELEGRAM_SUBJECT_ID,
    scope: WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_MANAGE,
  },
  {
    permission: permissions.accessPermissionManage,
    subjectId: TELEGRAM_SUBJECT_ID,
    scope: WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_INTERACT,
  },
  {
    permission: permissions.accessPermissionManage,
    subjectId: TELEGRAM_SUBJECT_ID,
    scope: WellKnownPermissions.TELEGRAM_NOTIFICATION_SEND_AS_SUBJECT,
  },
  {
    permission: permissions.accessPermissionManage,
    subjectId: TELEGRAM_SUBJECT_ID,
    scope: WellKnownPermissions.TELEGRAM_AVATAR_OWN,
  },
  {
    permission: permissions.accessPermissionManage,
    subjectId: TELEGRAM_SUBJECT_ID,
    scope: WellKnownPermissions.INTERACTION_NLS_ASK,
  },
  {
    permission: permissions.accessPermissionManage,
    subjectId: TELEGRAM_SUBJECT_ID,
    scope: WellKnownPermissions.INTERACTION_NLS_IMPERSONATE,
  },
  {
    permission: permissions.accessPermissionManage,
    subjectId: TELEGRAM_SUBJECT_ID,
    scope: WellKnownPermissions.INTERACTION_NLS_CLEAR_SUBJECT_CONTEXT,
  },
  {
    permission: permissions.telegramNotificationSendAsSubject,
    subjectId: TELEGRAM_SUBJECT_ID,
    scope: ACCESS_SUBJECT_ID,
  },
  { permission: permissions.telegramAvatarOwn, subjectId: TELEGRAM_SUBJECT_ID, scope: "telegram" },
  { permission: permissions.infraGatewayManage, subjectId: TELEGRAM_SUBJECT_ID, scope: "telegram" },
  {
    permission: permissions.reaperHandlerRegister,
    subjectId: TELEGRAM_SUBJECT_ID,
    scope: "telegram",
  },
  {
    permission: permissions.interactionNlsImpersonate,
    subjectId: TELEGRAM_SUBJECT_ID,
    scope: "telegram",
  },
  {
    permission: permissions.interactionNlsClearSubjectContext,
    subjectId: TELEGRAM_SUBJECT_ID,
    scope: "telegram",
  },

  // Static permission required by Reaper Replica bootstrap.
  {
    permission: permissions.accessPermissionManage,
    subjectId: REAPER_SUBJECT_ID,
    scope: WellKnownPermissions.REAPER_HANDLER_REGISTER,
  },
  { permission: permissions.reaperHandlerRegister, subjectId: REAPER_SUBJECT_ID, scope: "reaper" },
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

await registerReplica({
  replica: accessReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})

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

async function ensurePermissions<TDefinitions extends PermissionDefinitions>(
  definitions: TDefinitions,
): Promise<EnsuredPermissions<TDefinitions>> {
  const keys = Object.keys(definitions) as PermissionDefinitionKey<TDefinitions>[]
  const entries = await Promise.all(
    keys.map(async key => {
      const definition = definitions[key]
      if (definition === undefined) {
        throw new Error(`Permission definition "${key}" is missing`)
      }

      const permission = await ensurePermission(definition)

      return [key, permission] as const
    }),
  )

  return Object.fromEntries(entries) as EnsuredPermissions<TDefinitions>
}

async function ensureStaticBindings(bindings: StaticPermissionBinding[]): Promise<void> {
  await Promise.all(
    bindings.map(async binding => {
      await ensureBinding(binding.permission.id, binding.subjectId, binding.scope)
    }),
  )
}

async function ensurePermission({
  name,
  title,
  description,
  scoped,
}: EnsurePermissionInput): Promise<Permission> {
  const createTitle = normalizePermissionTitle(name, title)
  const createDescription = normalizePermissionDescription(description)

  return await services.prisma.permission.upsert({
    where: {
      name,
    },
    create: {
      name,
      title: createTitle,
      description: createDescription,
      scoped,
    },
    update: {
      scoped,
      ...(title !== undefined ? { title: normalizePermissionTitle(name, title) } : {}),
      ...(description !== undefined
        ? { description: normalizePermissionDescription(description) }
        : {}),
    },
  })
}

function normalizePermissionTitle(name: string, title: string | undefined): string {
  const trimmedTitle = title?.trim()

  return trimmedTitle && trimmedTitle.length > 0 ? trimmedTitle : name
}

function normalizePermissionDescription(description: string | undefined): string | null {
  const trimmedDescription = description?.trim()

  return trimmedDescription && trimmedDescription.length > 0 ? trimmedDescription : null
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
