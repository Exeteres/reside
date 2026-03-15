import type { DefinitionServiceClient } from "@reside/api/access/definition.v1"
import type { PrismaClient } from "../database"
import type { AccessE2EScope } from "./scope"
import { status } from "@grpc/grpc-js"
import { logger, WellKnownPermissions } from "@reside/common"

export async function assertDefinitionApi(
  definitionService: DefinitionServiceClient,
  prisma: PrismaClient,
  scope: AccessE2EScope,
): Promise<void> {
  const createdPermissionsResponse = await definitionService.putPermissions({
    permissions: [
      {
        name: scope.definitionPermissionName,
        title: "View reports",
        description: "Allows viewing reports during e2e validation",
        scoped: true,
      },
    ],
  })
  const createdPermission = createdPermissionsResponse.permissions[0]
  if (!createdPermission) {
    throw new Error("Permission definition response must contain one permission")
  }

  const updatedPermissionsResponse = await definitionService.putPermissions({
    permissions: [
      {
        name: createdPermission.name,
        title: "View updated reports",
        description: "Updated permission metadata during e2e validation",
        scoped: true,
      },
    ],
  })
  const updatedPermission = updatedPermissionsResponse.permissions[0]
  if (!updatedPermission) {
    throw new Error("Permission definition response must contain one updated permission")
  }

  if (createdPermission.id !== updatedPermission.id) {
    throw new Error("Permission upsert returned a different identifier")
  }

  const storedPermission = await prisma.permission.findUnique({
    where: {
      name: updatedPermission.name,
    },
  })

  if (!storedPermission || storedPermission.title !== updatedPermission.title) {
    throw new Error("Permission definition was not stored in the replica database")
  }

  const createdRealm = await prisma.realm.upsert({
    where: {
      name: scope.realmName,
    },
    create: {
      name: scope.realmName,
      title: "E2E users",
      description: "Realm created during e2e validation",
    },
    update: {
      title: "Updated E2E users",
      description: "Updated realm metadata during e2e validation",
    },
  })

  const updatedRealm = await prisma.realm.upsert({
    where: {
      name: scope.realmName,
    },
    create: {
      name: scope.realmName,
      title: "E2E users",
      description: "Realm created during e2e validation",
    },
    update: {
      title: "Updated E2E users",
      description: "Updated realm metadata during e2e validation",
    },
  })

  if (createdRealm.id !== updatedRealm.id) {
    throw new Error("Realm upsert returned a different identifier")
  }

  const storedRealm = await prisma.realm.findUnique({
    where: {
      name: scope.realmName,
    },
  })

  if (!storedRealm || storedRealm.title !== updatedRealm.title) {
    throw new Error("Realm definition was not stored in the replica database")
  }

  await assertRejectedDefinitionRequests(definitionService, prisma, scope)

  logger.info("definition api e2e checks passed")
}

async function assertRejectedDefinitionRequests(
  definitionService: DefinitionServiceClient,
  prisma: PrismaClient,
  scope: AccessE2EScope,
): Promise<void> {
  const forbiddenRealmName = `${scope.realmName}-forbidden-${scope.id}`

  await expectPermissionDenied(
    definitionService.putRealm({
      name: forbiddenRealmName,
      title: "Forbidden realm",
      description: "Should be rejected during e2e validation",
    }),
    [forbiddenRealmName, WellKnownPermissions.ACCESS_REALM_MANAGE],
  )

  const forbiddenRealm = await prisma.realm.findUnique({
    where: {
      name: forbiddenRealmName,
    },
  })
  if (forbiddenRealm) {
    throw new Error("Rejected realm definition was unexpectedly persisted")
  }
}

async function expectPermissionDenied(
  operation: Promise<unknown>,
  expectedMessageFragments: string[],
): Promise<void> {
  try {
    await operation
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }

    if (!error.message.includes("PERMISSION_DENIED")) {
      throw new Error(`Unexpected error message: ${error.message}`)
    }

    for (const expectedFragment of expectedMessageFragments) {
      if (!error.message.includes(expectedFragment)) {
        throw new Error(`Unexpected error message: ${error.message}`)
      }
    }

    const errorCode = Reflect.get(error, "code")
    if (errorCode !== status.PERMISSION_DENIED) {
      throw new Error(`Unexpected error code: ${String(errorCode)}`)
    }

    return
  }

  throw new Error("Expected permission denied error, but the request succeeded")
}
