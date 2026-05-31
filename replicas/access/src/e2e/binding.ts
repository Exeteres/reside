import type { BindingServiceClient } from "@reside/api/access/binding.v1"
import type { DefinitionServiceClient } from "@reside/api/access/definition.v1"
import type { PrismaClient } from "../database"
import type { AccessE2EScope } from "./scope"
import { logger } from "@reside/common"

const BINDING_SCOPE = "report:e2e-binding-scope"

export async function assertBindingApi(
  bindingService: BindingServiceClient,
  definitionService: DefinitionServiceClient,
  prisma: PrismaClient,
  scope: AccessE2EScope,
): Promise<void> {
  const subjectId = scope.bindingSubjectId

  const permissionsResponse = await definitionService.putPermissions({
    permissions: [
      {
        name: scope.bindingPermissionName,
        title: "List bindings",
        description: "Permission used for binding api e2e validation",
        scoped: true,
      },
    ],
  })
  const permission = permissionsResponse.permissions[0]
  if (!permission) {
    throw new Error("Permission definition response must contain one permission")
  }

  const existingGlobalBinding = await prisma.permissionBinding.findFirst({
    where: {
      permissionId: permission.id,
      subjectId,
      scope: null,
    },
    select: {
      id: true,
    },
  })

  if (!existingGlobalBinding) {
    await prisma.permissionBinding.create({
      data: {
        permissionId: permission.id,
        subjectId,
        scope: null,
      },
    })
  }

  await prisma.permissionBinding.upsert({
    where: {
      permissionId_subjectId_scope: {
        permissionId: permission.id,
        subjectId,
        scope: BINDING_SCOPE,
      },
    },
    create: {
      permissionId: permission.id,
      subjectId,
      scope: BINDING_SCOPE,
    },
    update: {},
  })

  await prisma.permissionRestriction.upsert({
    where: {
      permissionId_subjectId_scope: {
        permissionId: permission.id,
        subjectId,
        scope: BINDING_SCOPE,
      },
    },
    create: {
      permissionId: permission.id,
      subjectId,
      scope: BINDING_SCOPE,
    },
    update: {},
  })

  const allBindingsResponse = await bindingService.listPermissionBindings({
    subjectId,
  })

  if (allBindingsResponse.bindings.length < 2) {
    throw new Error("Binding service must return both global and scope-scoped bindings")
  }

  const hasResourceBinding = allBindingsResponse.bindings.some(
    binding => binding.scope === BINDING_SCOPE,
  )
  if (!hasResourceBinding) {
    throw new Error("Binding service returned no expected scope-scoped binding")
  }

  const restrictionsResponse = await bindingService.listPermissionRestrictions({
    subjectId,
  })
  const hasRestriction = restrictionsResponse.restrictions.some(
    restriction => restriction.scope === BINDING_SCOPE,
  )

  if (!hasRestriction) {
    throw new Error("Binding service returned no expected permission restriction")
  }

  logger.info("binding api e2e checks passed")
}
