import type { PrismaClient } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"

export function assertSubjectDisplayQueryReplica(replicaName: string): void {
  if (replicaName === "access" || replicaName === "alpha") {
    return
  }

  throw new ConnectError(
    `Replica "${replicaName}" is not allowed to query replica subject display info`,
    Code.PermissionDenied,
  )
}

export async function resolveReplicaSubjectDisplayInfo(prisma: PrismaClient, subjectId: string) {
  const parsedSubjectId = parseReplicaSubjectId(subjectId)
  if (parsedSubjectId === null) {
    throw new ConnectError('Subject ID must match format "replica:{name}"', Code.InvalidArgument)
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
    throw new ConnectError(`Subject "${subjectId}" was not found`, Code.NotFound)
  }

  return {
    title: replica.title,
    avatarUrl: replica.avatarUrl ?? undefined,
  }
}

export function parseReplicaSubjectId(subjectId: string): { name: string } | null {
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
