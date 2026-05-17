import type { SubjectServiceImplementation } from "@reside/api/common/subject.v1"
import type { PrismaClient } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"
import { authenticateReplica } from "@reside/common"

export function createSubjectService({
  prisma,
}: {
  prisma: PrismaClient
}): SubjectServiceImplementation {
  return {
    async getSubjectDisplayInfo(request, context) {
      const identity = await authenticateReplica(context)
      if (identity.name !== "access" && identity.name !== "alpha") {
        throw new ConnectError(
          `Replica "${identity.name}" is not allowed to query replica subject display info`,
          Code.PermissionDenied,
        )
      }

      const parsedSubjectId = parseReplicaSubjectId(request.subjectId)
      if (parsedSubjectId === null) {
        throw new ConnectError(
          'Subject ID must match format "replica:{name}"',
          Code.InvalidArgument,
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
        throw new ConnectError(`Subject "${request.subjectId}" was not found`, Code.NotFound)
      }

      return {
        title: replica.title,
        avatarUrl: replica.avatarUrl ?? undefined,
      }
    },
  }
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
