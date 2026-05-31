import type { PrismaClient } from "../database"
import type { AccessE2EScope } from "./scope"
import { WellKnownPermissions } from "@reside/registry"

export async function ensureE2EManageBindings(
  prisma: PrismaClient,
  scope: AccessE2EScope,
): Promise<void> {
  const managePermissions = await prisma.permission.findMany({
    where: {
      name: {
        in: [
          WellKnownPermissions.ACCESS_PERMISSION_MANAGE,
          WellKnownPermissions.ACCESS_REALM_MANAGE,
          WellKnownPermissions.ACCESS_SUBJECT_READ,
        ],
      },
    },
    select: {
      id: true,
      name: true,
    },
  })

  const permissionManagePermission = managePermissions.find(
    permission => permission.name === WellKnownPermissions.ACCESS_PERMISSION_MANAGE,
  )
  if (!permissionManagePermission) {
    throw new Error(`Permission "${WellKnownPermissions.ACCESS_PERMISSION_MANAGE}" was not found`)
  }

  const realmManagePermission = managePermissions.find(
    permission => permission.name === WellKnownPermissions.ACCESS_REALM_MANAGE,
  )
  if (!realmManagePermission) {
    throw new Error(`Permission "${WellKnownPermissions.ACCESS_REALM_MANAGE}" was not found`)
  }

  const subjectReadPermission = managePermissions.find(
    permission => permission.name === WellKnownPermissions.ACCESS_SUBJECT_READ,
  )
  if (!subjectReadPermission) {
    throw new Error(`Permission "${WellKnownPermissions.ACCESS_SUBJECT_READ}" was not found`)
  }

  const permissionScopes = [
    scope.definitionPermissionName,
    scope.authzScopedPermissionName,
    scope.authzGlobalPermissionName,
    scope.bindingPermissionName,
    scope.requestScopedPermissionName,
    scope.requestGlobalPermissionName,
  ]

  const subjectId = `replica:${scope.replicaName}`

  await Promise.all([
    ...permissionScopes.map(permissionScope =>
      prisma.permissionBinding.upsert({
        where: {
          permissionId_subjectId_scope: {
            permissionId: permissionManagePermission.id,
            subjectId,
            scope: permissionScope,
          },
        },
        create: {
          permissionId: permissionManagePermission.id,
          subjectId,
          scope: permissionScope,
        },
        update: {},
      }),
    ),
    prisma.permissionBinding.upsert({
      where: {
        permissionId_subjectId_scope: {
          permissionId: realmManagePermission.id,
          subjectId,
          scope: scope.realmName,
        },
      },
      create: {
        permissionId: realmManagePermission.id,
        subjectId,
        scope: scope.realmName,
      },
      update: {},
    }),
    prisma.permissionBinding.upsert({
      where: {
        permissionId_subjectId_scope: {
          permissionId: subjectReadPermission.id,
          subjectId,
          scope: scope.realmName,
        },
      },
      create: {
        permissionId: subjectReadPermission.id,
        subjectId,
        scope: scope.realmName,
      },
      update: {},
    }),
    prisma.permissionBinding.upsert({
      where: {
        permissionId_subjectId_scope: {
          permissionId: subjectReadPermission.id,
          subjectId,
          scope: scope.subjectNoEndpointRealmName,
        },
      },
      create: {
        permissionId: subjectReadPermission.id,
        subjectId,
        scope: scope.subjectNoEndpointRealmName,
      },
      update: {},
    }),
  ])
}
