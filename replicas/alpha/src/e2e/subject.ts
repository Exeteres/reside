import type { SubjectServiceClient } from "@reside/api/common/subject.v1"
import type { PrismaClient } from "../database"
import type { AlphaE2EScope } from "./scope"
import { Code } from "@connectrpc/connect"
import { logger } from "@reside/common"

export async function assertSubjectApi(
  subjectService: SubjectServiceClient,
  prisma: PrismaClient,
  scope: AlphaE2EScope,
): Promise<void> {
  const replica = await prisma.replica.findUnique({
    where: {
      name: scope.replicaName,
    },
    select: {
      title: true,
      avatarUrl: true,
    },
  })

  if (replica === null) {
    throw new Error(`Expected replica "${scope.replicaName}" to exist before subject checks`)
  }

  const displayInfo = await subjectService.getSubjectDisplayInfo({
    subjectId: scope.subjectId,
  })

  if (displayInfo.title !== replica.title) {
    throw new Error("subject service returned unexpected title")
  }

  if (displayInfo.avatarUrl !== (replica.avatarUrl ?? undefined)) {
    throw new Error("subject service returned unexpected avatar url")
  }

  await expectGrpcError(
    subjectService.getSubjectDisplayInfo({
      subjectId: "invalid-subject",
    }),
    Code.InvalidArgument,
    "replica:{name}",
  )

  await expectGrpcError(
    subjectService.getSubjectDisplayInfo({
      subjectId: "replica:alpha-e2e-not-found",
    }),
    Code.NotFound,
    "was not found",
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
