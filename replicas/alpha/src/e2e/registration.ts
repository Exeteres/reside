import type { RegistrationServiceClient } from "@reside/api/alpha/registration.v1"
import type { PrismaClient } from "../database"
import type { AlphaE2EScope } from "./scope"
import { logger } from "@reside/common"
import { getBaselineDependencies } from "./scope"

export async function assertRegistrationApi(
  registrationService: RegistrationServiceClient,
  prisma: PrismaClient,
  scope: AlphaE2EScope,
): Promise<void> {
  const baselineDependencies = await getBaselineDependencies(prisma, scope)
  const baselineReplica = await prisma.replica.findUnique({
    where: {
      name: scope.replicaName,
    },
    select: {
      title: true,
      description: true,
      avatarUrl: true,
      internalEndpoint: true,
      publicEndpoint: true,
    },
  })

  if (baselineReplica === null) {
    throw new Error(`Expected replica "${scope.replicaName}" to exist before registration checks`)
  }

  await prisma.replica.upsert({
    where: {
      name: scope.defaultReplicaName,
    },
    create: {
      name: scope.defaultReplicaName,
      title: "Alpha E2E Default Replica",
      description: "Replica created for alpha e2e registration checks",
      internalEndpoint: "http://alpha-e2e-default.internal",
    },
    update: {
      title: "Alpha E2E Default Replica",
      description: "Replica created for alpha e2e registration checks",
      internalEndpoint: "http://alpha-e2e-default.internal",
      publicEndpoint: null,
      avatarUrl: null,
    },
  })

  await registrationService.registerReplica({
    title: baselineReplica.title,
    description: baselineReplica.description ?? undefined,
    avatarUrl: baselineReplica.avatarUrl ?? undefined,
    internalEndpoint: baselineReplica.internalEndpoint,
    publicEndpoint: baselineReplica.publicEndpoint ?? undefined,
    replicaDependencies: [
      ...baselineDependencies.replicaDependencies,
      {
        name: scope.removedReplicaSlotName,
        defaultReplicaName: scope.missingDefaultReplicaName,
      },
      {
        name: scope.keptReplicaSlotName,
      },
    ],
    endpointDependencies: [
      ...baselineDependencies.endpointDependencies,
      {
        name: scope.removedEndpointSlotName,
        defaultEndpoint: scope.firstPublicEndpoint,
      },
      {
        name: scope.keptEndpointSlotName,
      },
    ],
  })

  const createdReplica = await prisma.replica.findUnique({
    where: {
      name: scope.replicaName,
    },
    include: {
      replicaDependencySlots: true,
      endpointDependencySlots: true,
    },
  })

  if (createdReplica === null) {
    throw new Error(`Expected replica "${scope.replicaName}" to be created`)
  }

  if (createdReplica.title !== baselineReplica.title) {
    throw new Error("registerReplica unexpectedly changed replica title")
  }

  const createdRemovedSlot = createdReplica.replicaDependencySlots.find(
    slot => slot.name === scope.removedReplicaSlotName,
  )
  if (createdRemovedSlot === undefined) {
    throw new Error("registerReplica did not create expected replica dependency slot")
  }

  if (createdRemovedSlot.defaultReplicaId !== null) {
    throw new Error(
      "registerReplica must reset default replica if requested default is not available",
    )
  }

  await registrationService.registerReplica({
    title: baselineReplica.title,
    description: baselineReplica.description ?? undefined,
    avatarUrl: baselineReplica.avatarUrl ?? undefined,
    internalEndpoint: baselineReplica.internalEndpoint,
    publicEndpoint: baselineReplica.publicEndpoint ?? undefined,
    replicaDependencies: [
      ...baselineDependencies.replicaDependencies,
      {
        name: scope.keptReplicaSlotName,
        defaultReplicaName: scope.defaultReplicaName,
      },
    ],
    endpointDependencies: [
      ...baselineDependencies.endpointDependencies,
      {
        name: scope.keptEndpointSlotName,
        defaultEndpoint: scope.secondEndpointDefault,
      },
    ],
  })

  const updatedReplica = await prisma.replica.findUnique({
    where: {
      name: scope.replicaName,
    },
    include: {
      replicaDependencySlots: true,
      endpointDependencySlots: true,
    },
  })

  if (updatedReplica === null) {
    throw new Error(`Expected replica "${scope.replicaName}" to exist after update`)
  }

  if (updatedReplica.title !== baselineReplica.title) {
    throw new Error("registerReplica unexpectedly changed replica title on second request")
  }

  if (
    updatedReplica.replicaDependencySlots.some(slot => slot.name === scope.removedReplicaSlotName)
  ) {
    throw new Error("registerReplica did not remove stale replica dependency slot")
  }

  const keptReplicaSlot = updatedReplica.replicaDependencySlots.find(
    slot => slot.name === scope.keptReplicaSlotName,
  )
  if (keptReplicaSlot === undefined) {
    throw new Error("registerReplica did not keep requested replica dependency slot")
  }

  const defaultReplica = await prisma.replica.findUnique({
    where: {
      name: scope.defaultReplicaName,
    },
    select: {
      id: true,
    },
  })

  if (defaultReplica === null) {
    throw new Error("e2e default replica was not found")
  }

  if (keptReplicaSlot.defaultReplicaId !== defaultReplica.id) {
    throw new Error("registerReplica did not update default replica value for dependency slot")
  }

  if (keptReplicaSlot.currentReplicaId !== null) {
    throw new Error(
      "registerReplica must not overwrite current replica value during default update",
    )
  }

  if (
    updatedReplica.endpointDependencySlots.some(slot => slot.name === scope.removedEndpointSlotName)
  ) {
    throw new Error("registerReplica did not remove stale endpoint dependency slot")
  }

  const keptEndpointSlot = updatedReplica.endpointDependencySlots.find(
    slot => slot.name === scope.keptEndpointSlotName,
  )
  if (keptEndpointSlot === undefined) {
    throw new Error("registerReplica did not keep requested endpoint dependency slot")
  }

  if (keptEndpointSlot.defaultEndpoint !== scope.secondEndpointDefault) {
    throw new Error("registerReplica did not update default endpoint value for dependency slot")
  }

  if (keptEndpointSlot.currentEndpoint !== null) {
    throw new Error(
      "registerReplica must not overwrite current endpoint value during default update",
    )
  }

  logger.info("registration api e2e checks passed")
}
