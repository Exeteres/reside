import type { PrismaClient } from "../../database"

export async function listReplicaInfos(prisma: PrismaClient) {
  const replicas = await prisma.replica.findMany({
    select: {
      id: true,
      name: true,
      title: true,
      description: true,
      internalEndpoint: true,
      publicEndpoint: true,
      version: true,
      changes: true,
    },
    orderBy: [{ name: "asc" }],
  })

  return {
    replicas: replicas.map(replica => ({
      id: replica.id,
      name: replica.name,
      title: replica.title,
      description: replica.description ?? undefined,
      internalEndpoint: replica.internalEndpoint,
      publicEndpoint: replica.publicEndpoint ?? undefined,
      version: replica.version ?? undefined,
      changes: replica.changes ?? undefined,
    })),
  }
}

export async function getReplicaInfo(prisma: PrismaClient, name: string) {
  const replica = await prisma.replica.findUnique({
    where: { name },
    select: {
      id: true,
      name: true,
      title: true,
      description: true,
      internalEndpoint: true,
      publicEndpoint: true,
      version: true,
      changes: true,
    },
  })

  if (!replica) {
    return { replica: undefined }
  }

  return {
    replica: {
      id: replica.id,
      name: replica.name,
      title: replica.title,
      description: replica.description ?? undefined,
      internal_endpoint: replica.internalEndpoint,
      public_endpoint: replica.publicEndpoint ?? undefined,
      version: replica.version ?? undefined,
      changes: replica.changes ?? undefined,
    },
  }
}
