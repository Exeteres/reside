import type { PrismaClient } from "../database"
import { getReplicaName } from "@reside/common"

export type AlphaE2EScope = {
  id: string
  replicaName: string
  loadReplicaName: string
  loadReplicaImage: string
  loadPermissionSetName: string
  defaultReplicaName: string
  firstTitle: string
  secondTitle: string
  firstDescription: string
  secondDescription: string
  firstAvatarUrl: string
  secondAvatarUrl: string
  firstInternalEndpoint: string
  secondInternalEndpoint: string
  firstPublicEndpoint: string
  secondPublicEndpoint: string
  removedReplicaSlotName: string
  keptReplicaSlotName: string
  removedEndpointSlotName: string
  keptEndpointSlotName: string
  missingDefaultReplicaName: string
  secondEndpointDefault: string
  subjectId: string
}

export type BaselineDependencies = {
  replicaDependencies: Array<{
    name: string
    defaultReplicaName?: string
  }>
  endpointDependencies: Array<{
    name: string
    defaultEndpoint?: string
  }>
}

export function createAlphaE2EScope(): AlphaE2EScope {
  const replicaName = getReplicaName()
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  return {
    id,
    replicaName,
    loadReplicaName: "alpha-e2e-load-stub",
    loadReplicaImage: "ghcr.io/exeteres/reside/replicas/alpha:load-e2e",
    loadPermissionSetName: "alpha-e2e-load",
    defaultReplicaName: `alpha-e2e-default-${id}`,
    firstTitle: "Alpha E2E Title 1",
    secondTitle: "Alpha E2E Title 2",
    firstDescription: "Alpha E2E description 1",
    secondDescription: "Alpha E2E description 2",
    firstAvatarUrl: "https://example.com/alpha-e2e-1.png",
    secondAvatarUrl: "https://example.com/alpha-e2e-2.png",
    firstInternalEndpoint: "http://alpha-e2e-1.internal",
    secondInternalEndpoint: "http://alpha-e2e-2.internal",
    firstPublicEndpoint: "https://alpha-e2e-1.example.com",
    secondPublicEndpoint: "https://alpha-e2e-2.example.com",
    removedReplicaSlotName: `alpha-e2e-replica-slot-remove-${id}`,
    keptReplicaSlotName: `alpha-e2e-replica-slot-keep-${id}`,
    removedEndpointSlotName: `alpha-e2e-endpoint-slot-remove-${id}`,
    keptEndpointSlotName: `alpha-e2e-endpoint-slot-keep-${id}`,
    missingDefaultReplicaName: `alpha-e2e-missing-replica-${id}`,
    secondEndpointDefault: "https://alpha-e2e-endpoint-2.example.com",
    subjectId: `replica:${replicaName}`,
  }
}

export async function cleanupAlphaE2EData(
  prisma: PrismaClient,
  scope: AlphaE2EScope,
): Promise<void> {
  const replica = await prisma.replica.findUnique({
    where: {
      name: scope.replicaName,
    },
    select: {
      id: true,
    },
  })

  if (replica !== null) {
    await prisma.replicaDependencySlot.deleteMany({
      where: {
        replicaId: replica.id,
        name: {
          in: [scope.removedReplicaSlotName, scope.keptReplicaSlotName],
        },
      },
    })

    await prisma.replicaEndpointDependencySlot.deleteMany({
      where: {
        replicaId: replica.id,
        name: {
          in: [scope.removedEndpointSlotName, scope.keptEndpointSlotName],
        },
      },
    })
  }

  await prisma.replica.deleteMany({
    where: {
      name: {
        in: [scope.defaultReplicaName, scope.loadReplicaName],
      },
    },
  })
}

export async function getBaselineDependencies(
  prisma: PrismaClient,
  scope: AlphaE2EScope,
): Promise<BaselineDependencies> {
  const replica = await prisma.replica.findUnique({
    where: {
      name: scope.replicaName,
    },
    include: {
      replicaDependencySlots: {
        include: {
          defaultReplica: {
            select: {
              name: true,
            },
          },
        },
      },
      endpointDependencySlots: {
        select: {
          name: true,
          defaultEndpoint: true,
        },
      },
    },
  })

  if (replica === null) {
    return {
      replicaDependencies: [],
      endpointDependencies: [],
    }
  }

  const replicaDependencies = replica.replicaDependencySlots
    .filter(
      slot => slot.name !== scope.removedReplicaSlotName && slot.name !== scope.keptReplicaSlotName,
    )
    .map(slot => ({
      name: slot.name,
      defaultReplicaName: slot.defaultReplica?.name ?? undefined,
    }))

  const endpointDependencies = replica.endpointDependencySlots
    .filter(
      slot =>
        slot.name !== scope.removedEndpointSlotName && slot.name !== scope.keptEndpointSlotName,
    )
    .map(slot => ({
      name: slot.name,
      defaultEndpoint: slot.defaultEndpoint ?? undefined,
    }))

  return {
    replicaDependencies,
    endpointDependencies,
  }
}
