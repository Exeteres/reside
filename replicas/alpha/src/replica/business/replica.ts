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
