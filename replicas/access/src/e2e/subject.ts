import type { DefinitionServiceClient } from "@reside/api/access/definition.v1"
import type { SubjectServiceClient } from "@reside/api/common/subject.v1"
import type { PrismaClient } from "../database"
import type { AccessE2EScope } from "./scope"
import { Code } from "@connectrpc/connect"
import { logger } from "@reside/common"

export async function assertSubjectApi(
  subjectService: SubjectServiceClient,
  definitionService: DefinitionServiceClient,
  prisma: PrismaClient,
  e2eSubjectServiceEndpoint: string,
  scope: AccessE2EScope,
): Promise<void> {
  await definitionService.putRealm({
    name: scope.realmName,
    title: "E2E users",
    description: "Realm created during e2e subject validation",
    subjectServiceEndpoint: e2eSubjectServiceEndpoint,
  })

  await prisma.realm.upsert({
    where: {
      name: scope.subjectDeniedRealmName,
    },
    create: {
      name: scope.subjectDeniedRealmName,
      title: "Denied realm",
      description: "Realm for denied subject scope checks",
      subjectServiceEndpoint: e2eSubjectServiceEndpoint,
    },
    update: {
      title: "Denied realm",
      description: "Realm for denied subject scope checks",
      subjectServiceEndpoint: e2eSubjectServiceEndpoint,
    },
  })

  await prisma.realm.upsert({
    where: {
      name: scope.subjectNoEndpointRealmName,
    },
    create: {
      name: scope.subjectNoEndpointRealmName,
      title: "No endpoint realm",
      description: "Realm for missing endpoint checks",
      subjectServiceEndpoint: null,
    },
    update: {
      title: "No endpoint realm",
      description: "Realm for missing endpoint checks",
      subjectServiceEndpoint: null,
    },
  })

  const successSubjectId = `${scope.realmName}:subject-a`
  const displayInfo = await subjectService.getSubjectDisplayInfo({
    subjectId: successSubjectId,
  })

  if (displayInfo.title !== "E2E subject-a") {
    throw new Error(`Subject service returned unexpected display title: ${displayInfo.title}`)
  }

  await expectGrpcError(
    subjectService.getSubjectDisplayInfo({
      subjectId: `${scope.subjectDeniedRealmName}:subject-b`,
    }),
    Code.PermissionDenied,
    "access:subject:read",
  )

  await expectGrpcError(
    subjectService.getSubjectDisplayInfo({
      subjectId: `${scope.subjectNoEndpointRealmName}:subject-c`,
    }),
    Code.FailedPrecondition,
    "has no subject service endpoint",
  )

  await expectGrpcError(
    subjectService.getSubjectDisplayInfo({
      subjectId: "invalid-subject",
    }),
    Code.InvalidArgument,
    "{realm}:{name}",
  )

  logger.info("subject api e2e checks passed")
}

async function expectGrpcError(
  operation: Promise<unknown>,
  expectedCode: number,
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
    if (errorCode !== expectedCode) {
      throw new Error(`Unexpected error code: ${String(errorCode)}`)
    }

    return
  }

  throw new Error("Expected gRPC error, but request succeeded")
}
