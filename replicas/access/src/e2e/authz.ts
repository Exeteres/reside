import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type { DefinitionServiceClient } from "@reside/api/access/definition.v1"
import type { PrismaClient } from "../database"
import type { AccessE2EScope } from "./scope"
import { status } from "@grpc/grpc-js"
import { logger } from "@reside/common"

const ALLOWED_SCOPE = "report:e2e-authz-allowed"
const DENIED_SCOPE = "report:e2e-authz-denied"

export async function assertAuthzApi(
  authzService: AuthzServiceClient,
  definitionService: DefinitionServiceClient,
  prisma: PrismaClient,
  scope: AccessE2EScope,
): Promise<void> {
  const globalSubjectId = scope.authzGlobalSubjectId
  const scopeSubjectId = scope.authzScopeSubjectId
  const unboundSubjectId = scope.authzUnboundSubjectId

  const scopedPermissionResponse = await definitionService.putPermissions({
    permissions: [
      {
        name: scope.authzScopedPermissionName,
        title: "Check reports",
        description: "Permission used for authz api e2e validation",
        scoped: true,
      },
    ],
  })
  const scopedPermission = scopedPermissionResponse.permissions[0]
  if (!scopedPermission) {
    throw new Error("Permission definition response must contain one scoped permission")
  }

  const globalPermissionResponse = await definitionService.putPermissions({
    permissions: [
      {
        name: scope.authzGlobalPermissionName,
        title: "Check global",
        description: "Global permission used for authz api e2e validation",
        scoped: false,
      },
    ],
  })
  const globalPermission = globalPermissionResponse.permissions[0]
  if (!globalPermission) {
    throw new Error("Permission definition response must contain one global permission")
  }

  await prisma.permissionBinding.upsert({
    where: {
      permissionId_subjectId_scope: {
        permissionId: scopedPermission.id,
        subjectId: scopeSubjectId,
        scope: ALLOWED_SCOPE,
      },
    },
    create: {
      permissionId: scopedPermission.id,
      subjectId: scopeSubjectId,
      scope: ALLOWED_SCOPE,
    },
    update: {},
  })

  const existingGlobalBinding = await prisma.permissionBinding.findFirst({
    where: {
      permissionId: globalPermission.id,
      subjectId: globalSubjectId,
      scope: null,
    },
    select: {
      id: true,
    },
  })

  if (!existingGlobalBinding) {
    await prisma.permissionBinding.create({
      data: {
        permissionId: globalPermission.id,
        subjectId: globalSubjectId,
        scope: null,
      },
    })
  }

  await assertPermissionResult(
    authzService,
    scope.authzScopedPermissionName,
    unboundSubjectId,
    false,
    "Unbound subject must not have permission without a binding",
    ALLOWED_SCOPE,
  )

  await assertPermissionResult(
    authzService,
    scope.authzScopedPermissionName,
    scopeSubjectId,
    true,
    "Scope-scoped binding must grant permission for the matching scope",
    ALLOWED_SCOPE,
  )

  await assertPermissionResult(
    authzService,
    scope.authzScopedPermissionName,
    scopeSubjectId,
    false,
    "Scope-scoped binding must not grant permission for a different scope",
    DENIED_SCOPE,
  )

  await assertPermissionResult(
    authzService,
    scope.authzGlobalPermissionName,
    globalSubjectId,
    true,
    "Global binding must grant permission for global checks",
  )

  await expectInvalidArgument(
    authzService.checkPermission({
      permissionName: scope.authzGlobalPermissionName,
      subjectId: globalSubjectId,
      scope: ALLOWED_SCOPE,
    }),
    "is not scoped and does not accept scope descriptor",
  )

  logger.info("authz api e2e checks passed")
}

async function assertPermissionResult(
  authzService: AuthzServiceClient,
  permissionName: string,
  subjectId: string,
  expected: boolean,
  failureMessage: string,
  scope?: string,
): Promise<void> {
  const response = await authzService.checkPermission({
    permissionName,
    subjectId,
    scope,
  })

  if (response.authorized !== expected) {
    throw new Error(failureMessage)
  }
}

async function expectInvalidArgument(
  operation: Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await operation
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }

    if (!error.message.includes(expectedMessage)) {
      throw new Error(`Unexpected error message: ${error.message}`)
    }

    const errorCode = Reflect.get(error, "code")
    if (errorCode !== status.INVALID_ARGUMENT) {
      throw new Error(`Unexpected error code: ${String(errorCode)}`)
    }

    return
  }

  throw new Error("Expected invalid argument error, but the request succeeded")
}
