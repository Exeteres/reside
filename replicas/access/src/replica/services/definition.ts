import type {
  Approver,
  DefinitionServiceImplementation,
  Permission,
  PutApproverRequest,
  PutPermissionsRequest,
  PutPermissionsResponse,
  PutRealmRequest,
  Realm,
} from "@reside/api/access/definition.v1"
import type { PrismaClient } from "../../database"
import { status } from "@grpc/grpc-js"
import { authenticateReplica, logger, WellKnownPermissions } from "@reside/common"
import { type CallContext, ServerError } from "nice-grpc"
import { isAuthorizedByPermissionBinding } from "./permission-auth"

const REALM_MANAGE_PERMISSION_NAME = WellKnownPermissions.ACCESS_REALM_MANAGE
const PERMISSION_MANAGE_PERMISSION_NAME = WellKnownPermissions.ACCESS_PERMISSION_MANAGE
const APPROVER_MANAGE_PERMISSION_NAME = WellKnownPermissions.ACCESS_APPROVER_MANAGE

export function createDefinitionService(prisma: PrismaClient) {
  const service: DefinitionServiceImplementation = {
    async putPermissions(
      request: PutPermissionsRequest,
      context: CallContext,
    ): Promise<PutPermissionsResponse> {
      const replicaSubjectId = await getReplicaSubjectIdFromContext(context)

      logger.info(
        'definition.putPermissions requested by "%s" with %d permissions',
        replicaSubjectId,
        request.permissions.length,
      )

      const permissionNames = [...new Set(request.permissions.map(permission => permission.name))]
      await Promise.all(
        permissionNames.map(async permissionName => {
          await assertSubjectCanManagePermission(prisma, {
            subjectId: replicaSubjectId,
            permissionName: PERMISSION_MANAGE_PERMISSION_NAME,
            scope: permissionName,
          })
        }),
      )

      const permissions = await Promise.all(
        request.permissions.map(async permissionRequest => {
          const permission = await prisma.permission.upsert({
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

          return toPermissionResponse(permission)
        }),
      )

      return {
        permissions,
      }
    },

    async putRealm(request: PutRealmRequest, context: CallContext): Promise<Realm> {
      const replicaSubjectId = await getReplicaSubjectIdFromContext(context)

      logger.info(
        'definition.putRealm requested by "%s" for realm "%s"',
        replicaSubjectId,
        request.name,
      )

      await assertSubjectCanManagePermission(prisma, {
        subjectId: replicaSubjectId,
        permissionName: REALM_MANAGE_PERMISSION_NAME,
        scope: request.name,
      })

      const realm = await prisma.realm.upsert({
        where: {
          name: request.name,
        },
        create: {
          name: request.name,
          title: request.title,
          description: request.description,
          subjectServiceEndpoint: request.subjectServiceEndpoint ?? null,
        },
        update: {
          title: request.title,
          description: request.description,
          subjectServiceEndpoint: request.subjectServiceEndpoint ?? null,
        },
      })

      return toRealmResponse(realm)
    },

    async putApprover(request: PutApproverRequest, context: CallContext): Promise<Approver> {
      const replicaName = await getReplicaNameFromContext(context)

      logger.info(
        'definition.putApprover requested by replica "%s" for approver "%s"',
        replicaName,
        request.name,
      )

      assertApproverName(request.name)
      assertApproverPriority(request.priority)
      const normalizedRealmNames = normalizeRealmNames(request.realms)
      assertCallbackEndpoint(request.callbackEndpoint)

      const permissionScope = buildApproverManageScope({
        name: request.name,
        priority: request.priority,
        realms: normalizedRealmNames,
      })

      await assertSubjectCanManagePermission(prisma, {
        subjectId: `replica:${replicaName}`,
        permissionName: APPROVER_MANAGE_PERMISSION_NAME,
        scope: permissionScope,
      })

      await assertRealmsExist(prisma, normalizedRealmNames)

      const approver = await prisma.approver.upsert({
        where: {
          name: request.name,
        },
        create: {
          name: request.name,
          priority: request.priority,
          realms: {
            connect: normalizedRealmNames.map(name => ({ name })),
          },
          title: request.title,
          description: request.description ?? null,
          callbackEndpoint: request.callbackEndpoint,
        },
        update: {
          priority: request.priority,
          realms: {
            set: normalizedRealmNames.map(name => ({ name })),
          },
          title: request.title,
          description: request.description ?? null,
          callbackEndpoint: request.callbackEndpoint,
        },
        include: {
          realms: true,
        },
      })

      return toApproverResponse(approver)
    },
  }

  return service
}

async function getReplicaNameFromContext(context: CallContext): Promise<string> {
  const identity = await authenticateReplica(context)
  return identity.name
}

async function getReplicaSubjectIdFromContext(context: CallContext): Promise<string> {
  const replicaName = await getReplicaNameFromContext(context)
  return `replica:${replicaName}`
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

  throw new ServerError(
    status.PERMISSION_DENIED,
    `Subject "${request.subjectId}" lacks "${request.permissionName}" for scope "${request.scope}"`,
  )
}

function assertApproverName(name: string): void {
  if (/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    return
  }

  throw new ServerError(
    status.INVALID_ARGUMENT,
    'Approver name must match "name" format (e.g., "auto-approver")',
  )
}

function assertApproverPriority(priority: number): void {
  if (Number.isInteger(priority) && priority >= 0) {
    return
  }

  throw new ServerError(status.INVALID_ARGUMENT, "Approver priority must be a non-negative integer")
}

function normalizeRealmNames(realms: string[]): string[] {
  const normalizedRealmNames = [...new Set(realms.map(realm => realm.trim()))].sort((a, b) =>
    a.localeCompare(b),
  )

  if (normalizedRealmNames.length === 0) {
    throw new ServerError(status.INVALID_ARGUMENT, "Approver must define at least one realm")
  }

  for (const realm of normalizedRealmNames) {
    if (realm.length === 0 || realm.includes(":")) {
      throw new ServerError(status.INVALID_ARGUMENT, `Approver allowed realm "${realm}" is invalid`)
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

  throw new ServerError(status.NOT_FOUND, `Realms not found: ${missingRealmNames.join(", ")}`)
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

  throw new ServerError(status.INVALID_ARGUMENT, "Approver callback endpoint is required")
}

function toPermissionResponse(permission: {
  id: number
  name: string
  title: string
  description: string | null
  scoped: boolean
}): Permission {
  return {
    id: permission.id,
    name: permission.name,
    title: permission.title,
    description: permission.description ?? undefined,
    scoped: permission.scoped,
  }
}

function toRealmResponse(realm: {
  id: number
  name: string
  title: string
  description: string | null
  subjectServiceEndpoint: string | null
}): Realm {
  return {
    id: realm.id,
    name: realm.name,
    title: realm.title,
    description: realm.description ?? undefined,
    subjectServiceEndpoint: realm.subjectServiceEndpoint ?? undefined,
  }
}

function toApproverResponse(approver: {
  id: number
  name: string
  priority: number
  realms: Array<{
    id: number
    name: string
    title: string
    description: string | null
    subjectServiceEndpoint: string | null
  }>
  title: string
  description: string | null
  callbackEndpoint: string
}): Approver {
  return {
    id: approver.id,
    name: approver.name,
    priority: approver.priority,
    realms: approver.realms.map(realm => toRealmResponse(realm)),
    title: approver.title,
    description: approver.description ?? undefined,
    callbackEndpoint: approver.callbackEndpoint,
  }
}
