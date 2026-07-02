import type { PrismaClient } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"
import { logger } from "@reside/common"
import { WellKnownPermissions } from "@reside/registry"
import { isAuthorizedByPermissionBinding } from "./permission-auth"

const REALM_MANAGE_PERMISSION_NAME = WellKnownPermissions.ACCESS_REALM_MANAGE
const PERMISSION_MANAGE_PERMISSION_NAME = WellKnownPermissions.ACCESS_PERMISSION_MANAGE
const APPROVER_MANAGE_PERMISSION_NAME = WellKnownPermissions.ACCESS_APPROVER_MANAGE

export type PermissionUpsertRequest = {
  name: string
  title: string
  description: string | undefined
  scoped: boolean
}

export type RealmUpsertRequest = {
  name: string
  title: string
  description: string | undefined
  subjectServiceEndpoint: string | undefined
}

export type ApproverUpsertRequest = {
  name: string
  priority: number
  realms: string[]
  title: string
  description: string | undefined
  callbackEndpoint: string
}

export type PermissionRecord = {
  id: number
  name: string
  title: string
  description: string | null
  scoped: boolean
}

export type RealmRecord = {
  id: number
  name: string
  title: string
  description: string | null
  subjectServiceEndpoint: string | null
}

export type ApproverRecord = {
  id: number
  name: string
  priority: number
  realms: RealmRecord[]
  title: string
  description: string | null
  callbackEndpoint: string
}

export async function putPermissions(
  prisma: PrismaClient,
  replicaSubjectId: string,
  permissions: PermissionUpsertRequest[],
) {
  logger.info(
    'definition.putPermissions requested by "%s" with %d permissions',
    replicaSubjectId,
    permissions.length,
  )

  const permissionNames = [...new Set(permissions.map(permission => permission.name))]
  await Promise.all(
    permissionNames.map(async permissionName => {
      await assertSubjectCanManagePermission(prisma, {
        subjectId: replicaSubjectId,
        permissionName: PERMISSION_MANAGE_PERMISSION_NAME,
        scope: permissionName,
      })
    }),
  )

  return await Promise.all(
    permissions.map(async permissionRequest => {
      return await prisma.permission.upsert({
        where: {
          name: permissionRequest.name,
        },
        create: {
          name: permissionRequest.name,
          title: permissionRequest.title,
          description: permissionRequest.description ?? null,
          scoped: permissionRequest.scoped,
        },
        update: {
          title: permissionRequest.title,
          description: permissionRequest.description ?? null,
          scoped: permissionRequest.scoped,
        },
      })
    }),
  )
}

export async function putRealm(
  prisma: PrismaClient,
  replicaSubjectId: string,
  realmRequest: RealmUpsertRequest,
) {
  logger.info(
    'definition.putRealm requested by "%s" for realm "%s"',
    replicaSubjectId,
    realmRequest.name,
  )

  await assertSubjectCanManagePermission(prisma, {
    subjectId: replicaSubjectId,
    permissionName: REALM_MANAGE_PERMISSION_NAME,
    scope: realmRequest.name,
  })

  return await prisma.realm.upsert({
    where: {
      name: realmRequest.name,
    },
    create: {
      name: realmRequest.name,
      title: realmRequest.title,
      description: realmRequest.description ?? null,
      subjectServiceEndpoint: realmRequest.subjectServiceEndpoint ?? null,
    },
    update: {
      title: realmRequest.title,
      description: realmRequest.description ?? null,
      subjectServiceEndpoint: realmRequest.subjectServiceEndpoint ?? null,
    },
  })
}

export async function putApprover(
  prisma: PrismaClient,
  replicaName: string,
  approverRequest: ApproverUpsertRequest,
) {
  logger.info(
    'definition.putApprover requested by replica "%s" for approver "%s"',
    replicaName,
    approverRequest.name,
  )

  assertApproverName(approverRequest.name)
  assertApproverPriority(approverRequest.priority)
  const normalizedRealmNames = normalizeRealmNames(approverRequest.realms)
  assertCallbackEndpoint(approverRequest.callbackEndpoint)

  const permissionScope = buildApproverManageScope({
    name: approverRequest.name,
    priority: approverRequest.priority,
    realms: normalizedRealmNames,
  })

  await assertSubjectCanManagePermission(prisma, {
    subjectId: `replica:${replicaName}`,
    permissionName: APPROVER_MANAGE_PERMISSION_NAME,
    scope: permissionScope,
  })

  await assertRealmsExist(prisma, normalizedRealmNames)

  return await prisma.approver.upsert({
    where: {
      name: approverRequest.name,
    },
    create: {
      name: approverRequest.name,
      priority: approverRequest.priority,
      realms: {
        connect: normalizedRealmNames.map(name => ({ name })),
      },
      title: approverRequest.title,
      description: approverRequest.description ?? null,
      callbackEndpoint: approverRequest.callbackEndpoint,
      ownerReplicaName: replicaName,
    },
    update: {
      priority: approverRequest.priority,
      realms: {
        set: normalizedRealmNames.map(name => ({ name })),
      },
      title: approverRequest.title,
      description: approverRequest.description ?? null,
      callbackEndpoint: approverRequest.callbackEndpoint,
      ownerReplicaName: replicaName,
    },
    include: {
      realms: true,
    },
  })
}

async function assertSubjectCanManagePermission(
  prisma: PrismaClient,
  request: {
    subjectId: string
    permissionName: string
    scope: string
  },
): Promise<void> {
  const authorized = await isAuthorizedByPermissionBinding(prisma, {
    permissionName: request.permissionName,
    subjectId: request.subjectId,
    scope: request.scope,
  })

  if (authorized) {
    return
  }

  throw new ConnectError(
    `Subject "${request.subjectId}" lacks "${request.permissionName}" for scope "${request.scope}"`,
    Code.PermissionDenied,
  )
}

function assertApproverName(name: string): void {
  if (/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    return
  }

  throw new ConnectError(
    'Approver name must match "name" format (e.g., "auto-approver")',
    Code.InvalidArgument,
  )
}

function assertApproverPriority(priority: number): void {
  if (Number.isInteger(priority) && priority >= 0) {
    return
  }

  throw new ConnectError("Approver priority must be a non-negative integer", Code.InvalidArgument)
}

function normalizeRealmNames(realms: string[]): string[] {
  const normalizedRealmNames = [...new Set(realms.map(realm => realm.trim()))].sort((a, b) =>
    a.localeCompare(b),
  )

  if (normalizedRealmNames.length === 0) {
    throw new ConnectError("Approver must define at least one realm", Code.InvalidArgument)
  }

  for (const realm of normalizedRealmNames) {
    if (realm.length === 0 || realm.includes(":")) {
      throw new ConnectError(`Approver allowed realm "${realm}" is invalid`, Code.InvalidArgument)
    }
  }

  return normalizedRealmNames
}

async function assertRealmsExist(prisma: PrismaClient, realms: string[]): Promise<void> {
  const existingRealms = await prisma.realm.findMany({
    where: {
      name: {
        in: realms,
      },
    },
    select: {
      name: true,
    },
  })

  const existingRealmNames = new Set(existingRealms.map(realm => realm.name))
  const missingRealmNames = realms.filter(realm => !existingRealmNames.has(realm))
  if (missingRealmNames.length === 0) {
    return
  }

  throw new ConnectError(`Realms not found: ${missingRealmNames.join(", ")}`, Code.NotFound)
}

function buildApproverManageScope(args: {
  name: string
  priority: number
  realms: string[]
}): string {
  return `${args.name}:${args.priority}:${args.realms.join(":")}`
}

function assertCallbackEndpoint(callbackEndpoint: string): void {
  if (callbackEndpoint.length > 0) {
    return
  }

  throw new ConnectError("Approver callback endpoint is required", Code.InvalidArgument)
}
