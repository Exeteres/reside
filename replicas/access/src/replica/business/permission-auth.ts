import type { PrismaClient } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"
import { logger } from "@reside/common"

export type PermissionAuthorizationRequest = {
  permissionName: string
  subjectId: string
  scope: string | undefined
}

export async function isAuthorizedByPermissionBinding(
  prisma: PrismaClient,
  request: PermissionAuthorizationRequest,
): Promise<boolean> {
  logger.debug(
    "checking permission binding authorization for permission %s and subject %s",
    request.permissionName,
    request.subjectId,
  )

  const permission = await prisma.permission.findUnique({
    where: {
      name: request.permissionName,
    },
    select: {
      id: true,
      scoped: true,
    },
  })

  if (!permission) {
    throw new ConnectError(`Permission "${request.permissionName}" was not found`, Code.NotFound)
  }

  assertPermissionScopeCompatibility(request.permissionName, permission.scoped, request.scope)

  const authorized = await hasMatchingBinding(prisma, {
    permissionId: permission.id,
    subjectId: request.subjectId,
    scope: request.scope,
  })

  logger.debug(
    "permission binding authorization result for permission %s and subject %s: %s",
    request.permissionName,
    request.subjectId,
    authorized,
  )

  return authorized
}

function assertPermissionScopeCompatibility(
  permissionName: string,
  scoped: boolean,
  scope: string | undefined,
): void {
  if (scoped && scope === undefined) {
    throw new ConnectError(
      `Permission "${permissionName}" requires scope descriptor`,
      Code.InvalidArgument,
    )
  }

  if (!scoped && scope !== undefined) {
    throw new ConnectError(
      `Permission "${permissionName}" is not scoped and does not accept scope descriptor`,
      Code.InvalidArgument,
    )
  }
}

async function hasMatchingBinding(
  prisma: PrismaClient,
  request: {
    permissionId: number
    subjectId: string
    scope: string | undefined
  },
): Promise<boolean> {
  if (request.scope !== undefined) {
    const [resourceScopedBinding, globalBinding] = await Promise.all([
      prisma.permissionBinding.findUnique({
        where: {
          permissionId_subjectId_scope: {
            permissionId: request.permissionId,
            subjectId: request.subjectId,
            scope: request.scope,
          },
        },
        select: {
          id: true,
        },
      }),
      prisma.permissionBinding.findFirst({
        where: {
          permissionId: request.permissionId,
          subjectId: request.subjectId,
          scope: null,
        },
        select: {
          id: true,
        },
      }),
    ])

    return resourceScopedBinding !== null || globalBinding !== null
  }

  const binding = await prisma.permissionBinding.findFirst({
    where: {
      permissionId: request.permissionId,
      subjectId: request.subjectId,
      scope: null,
    },
    select: {
      id: true,
    },
  })

  return binding !== null
}
