import type { PrismaClient } from "../database"
import { getReplicaName, WellKnownPermissions } from "@reside/common"

const legacyPermissionNames = [
  "e2e-view-reports",
  "e2e-check-reports",
  "e2e-check-global",
  "e2e-list-bindings",
  "e2e-request-reports",
  "e2e-request-global",
]

const legacySubjectIds = [
  `${getReplicaName()}:authz-global-user`,
  `${getReplicaName()}:authz-scope-user`,
  `${getReplicaName()}:authz-unbound-user`,
  `${getReplicaName()}:binding-user`,
  `${getReplicaName()}:request-user`,
  `${getReplicaName()}:request-global-user`,
]

const legacyPermissionSetNames = ["e2e-request-scoped", "e2e-request-global"]

export type AccessE2EScope = {
  id: string
  replicaName: string
  realmName: string
  subjectDeniedRealmName: string
  subjectNoEndpointRealmName: string
  definitionPermissionName: string
  authzScopedPermissionName: string
  authzGlobalPermissionName: string
  bindingPermissionName: string
  requestScopedPermissionName: string
  requestGlobalPermissionName: string
  authzGlobalSubjectId: string
  authzScopeSubjectId: string
  authzUnboundSubjectId: string
  bindingSubjectId: string
  requestScopedSubjectId: string
  requestGlobalSubjectId: string
  requestScopedPermissionSetName: string
  requestGlobalPermissionSetName: string
  requestReusePermissionSetName: string
  requestSupersedePermissionSetName: string
  requestReuseSubjectId: string
  requestSupersedeSubjectId: string
  approverName: string
  approverPriority: number
  approverRealms: string[]
}

export function createAccessE2EScope(): AccessE2EScope {
  const replicaName = getReplicaName()
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const realmName = `access-e2e-${id}`
  const subjectDeniedRealmName = `${realmName}-subject-denied`
  const subjectNoEndpointRealmName = `${realmName}-subject-no-endpoint`

  return {
    id,
    replicaName,
    realmName,
    subjectDeniedRealmName,
    subjectNoEndpointRealmName,
    definitionPermissionName: `e2e-view-reports-${id}`,
    authzScopedPermissionName: `e2e-check-reports-${id}`,
    authzGlobalPermissionName: `e2e-check-global-${id}`,
    bindingPermissionName: `e2e-list-bindings-${id}`,
    requestScopedPermissionName: `e2e-request-reports-${id}`,
    requestGlobalPermissionName: `e2e-request-global-${id}`,
    authzGlobalSubjectId: `${realmName}:authz-global-user-${id}`,
    authzScopeSubjectId: `${realmName}:authz-scope-user-${id}`,
    authzUnboundSubjectId: `${realmName}:authz-unbound-user-${id}`,
    bindingSubjectId: `${realmName}:binding-user-${id}`,
    requestScopedSubjectId: `${realmName}:request-user-${id}`,
    requestGlobalSubjectId: `${realmName}:request-global-user-${id}`,
    requestScopedPermissionSetName: `e2e-request-scoped-${id}`,
    requestGlobalPermissionSetName: `e2e-request-global-${id}`,
    requestReusePermissionSetName: `e2e-request-reuse-${id}`,
    requestSupersedePermissionSetName: `e2e-request-supersede-${id}`,
    requestReuseSubjectId: `${realmName}:request-reuse-user-${id}`,
    requestSupersedeSubjectId: `${realmName}:request-supersede-user-${id}`,
    approverName: `access-e2e-${id}`,
    approverPriority: 99,
    approverRealms: [realmName],
  }
}

export async function cleanupAccessE2EData(
  prisma: PrismaClient,
  scope: AccessE2EScope,
): Promise<void> {
  const permissionSetNames = [
    ...legacyPermissionSetNames,
    scope.requestScopedPermissionSetName,
    scope.requestGlobalPermissionSetName,
    scope.requestReusePermissionSetName,
    scope.requestSupersedePermissionSetName,
  ]
  const subjectIds = [
    ...legacySubjectIds,
    scope.authzGlobalSubjectId,
    scope.authzScopeSubjectId,
    scope.authzUnboundSubjectId,
    scope.bindingSubjectId,
    scope.requestScopedSubjectId,
    scope.requestGlobalSubjectId,
    scope.requestReuseSubjectId,
    scope.requestSupersedeSubjectId,
  ]
  const permissionNames = [
    ...legacyPermissionNames,
    scope.definitionPermissionName,
    scope.authzScopedPermissionName,
    scope.authzGlobalPermissionName,
    scope.bindingPermissionName,
    scope.requestScopedPermissionName,
    scope.requestGlobalPermissionName,
  ]
  const replicaSubjectId = `replica:${scope.replicaName}`

  await prisma.operation.deleteMany({
    where: {
      permissionRequestSet: {
        permissionSetName: {
          in: permissionSetNames,
        },
      },
    },
  })

  await prisma.permissionRequestSetItem.deleteMany({
    where: {
      requestSet: {
        permissionSetName: {
          in: permissionSetNames,
        },
      },
    },
  })

  await prisma.permissionRequestSetItem.deleteMany({
    where: {
      permission: {
        name: {
          in: permissionNames,
        },
      },
    },
  })

  await prisma.permissionRequestSet.deleteMany({
    where: {
      permissionSetName: {
        in: permissionSetNames,
      },
    },
  })

  await prisma.permissionSetItem.deleteMany({
    where: {
      permissionSet: {
        name: {
          in: permissionSetNames,
        },
      },
    },
  })

  await prisma.permissionSetItem.deleteMany({
    where: {
      permission: {
        name: {
          in: permissionNames,
        },
      },
    },
  })

  await prisma.permissionSet.deleteMany({
    where: {
      name: {
        in: permissionSetNames,
      },
    },
  })

  await prisma.permissionBinding.deleteMany({
    where: {
      subjectId: {
        in: subjectIds,
      },
    },
  })

  await prisma.permissionBinding.deleteMany({
    where: {
      subjectId: replicaSubjectId,
      permission: {
        name: {
          in: [
            WellKnownPermissions.ACCESS_PERMISSION_MANAGE,
            WellKnownPermissions.ACCESS_REALM_MANAGE,
            WellKnownPermissions.ACCESS_SUBJECT_READ,
          ],
        },
      },
      scope: {
        in: [...permissionNames, scope.realmName, scope.subjectNoEndpointRealmName],
      },
    },
  })

  await prisma.permissionRestriction.deleteMany({
    where: {
      subjectId: {
        in: subjectIds,
      },
    },
  })

  await prisma.approver.deleteMany({
    where: {
      name: {
        in: [scope.approverName],
      },
    },
  })

  await prisma.realm.deleteMany({
    where: {
      name: {
        in: [scope.realmName, scope.subjectDeniedRealmName, scope.subjectNoEndpointRealmName],
      },
    },
  })

  await prisma.permission.deleteMany({
    where: {
      name: {
        in: permissionNames,
      },
    },
  })
}
