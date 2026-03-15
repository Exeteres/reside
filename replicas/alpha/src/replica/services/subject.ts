import type {
  GetSubjectDisplayInfoRequest,
  SubjectDisplayInfo,
  SubjectServiceImplementation,
} from "@reside/api/common/subject.v1"
import type { PrismaClient } from "../../database"
import { status } from "@grpc/grpc-js"
import { authenticateReplica } from "@reside/common"
import { type CallContext, ServerError } from "nice-grpc"

export function createSubjectService(prisma: PrismaClient): SubjectServiceImplementation {
  const service: SubjectServiceImplementation = {
    async getSubjectDisplayInfo(
      request: GetSubjectDisplayInfoRequest,
      context: CallContext,
    ): Promise<SubjectDisplayInfo> {
      const identity = await authenticateReplica(context)
      if (identity.name !== "access" && identity.name !== "alpha") {
        throw new ServerError(
          status.PERMISSION_DENIED,
          `Replica "${identity.name}" is not allowed to query replica subject display info`,
        )
      }

      const parsedSubjectId = parseReplicaSubjectId(request.subjectId)
      if (parsedSubjectId === null) {
        throw new ServerError(
          status.INVALID_ARGUMENT,
          'Subject ID must match format "replica:{name}"',
        )
      }

      const replica = await prisma.replica.findUnique({
        where: {
          name: parsedSubjectId.name,
        },
        select: {
          title: true,
          avatarUrl: true,
        },
      })

      if (replica === null) {
        throw new ServerError(status.NOT_FOUND, `Subject "${request.subjectId}" was not found`)
      }

      return {
        title: replica.title,
        avatarUrl: replica.avatarUrl ?? undefined,
      }
    },
  }

  return service
}

function parseReplicaSubjectId(subjectId: string): { name: string } | null {
  const segments = subjectId.trim().split(":")
  if (segments.length !== 2) {
    return null
  }

  const realm = segments[0]
  const name = segments[1]
  if (realm !== "replica" || !name) {
    return null
  }

  return {
    name,
  }
}
