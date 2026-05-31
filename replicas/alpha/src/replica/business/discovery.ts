import type { PrismaClient } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"
import { resolveDesiredReplicaEndpoints } from "../../shared/replica-crd"

export async function resolveEffectiveEndpoints(prisma: PrismaClient, replicaName: string) {
  const replica = await prisma.replica.findUnique({
    where: {
      name: replicaName,
    },
    select: {
      name: true,
      image: true,
      replicaDependencySlots: {
        select: {
          name: true,
          currentReplica: {
            select: {
              internalEndpoint: true,
            },
          },
        },
      },
      endpointDependencySlots: {
        select: {
          name: true,
          defaultEndpoint: true,
          currentEndpoint: true,
        },
      },
    },
  })

  if (replica === null) {
    throw new ConnectError(`Replica "${replicaName}" is not registered in alpha`, Code.NotFound)
  }

  return {
    endpoints: resolveDesiredReplicaEndpoints(replica),
  }
}

export async function resolveSubjectEndpointBySubjectId(prisma: PrismaClient, subjectId: string) {
  const parsedSubject = parseReplicaSubjectId(subjectId)
  if (!parsedSubject) {
    throw new ConnectError('subject_id must be in format "replica:{name}"', Code.InvalidArgument)
  }

  const replica = await prisma.replica.findUnique({
    where: {
      name: parsedSubject.replicaName,
    },
    select: {
      internalEndpoint: true,
    },
  })

  if (!replica) {
    throw new ConnectError(
      `Replica "${parsedSubject.replicaName}" is not registered in alpha`,
      Code.NotFound,
    )
  }

  return {
    endpoint: replica.internalEndpoint,
  }
}

export function parseReplicaSubjectId(subjectId: string): { replicaName: string } | null {
  const [realm = "", replicaName = "", ...rest] = subjectId.split(":")
  if (realm !== "replica" || replicaName.length === 0 || rest.length > 0) {
    return null
  }

  return { replicaName }
}
