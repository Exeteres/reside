import type {
  RegisterReplicaRequest,
  RegistrationServiceImplementation,
} from "@reside/api/alpha/registration.v1"
import type { PrismaClient } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"
import { authenticateReplica } from "@reside/common"

export function createRegistrationService({
  prisma,
}: {
  prisma: PrismaClient
}): RegistrationServiceImplementation {
  return {
    async registerReplica(request, context) {
      const identity = await authenticateReplica(context)

      const replicaName = identity.name
      const title = request.title.trim()
      const description = toNullableText(request.description)
      const avatarUrl = toNullableText(request.avatarUrl)
      const internalEndpoint = request.internalEndpoint.trim()
      const publicEndpoint = toNullableText(request.publicEndpoint)

      assertRequiredValue(title, "title")
      assertRequiredValue(internalEndpoint, "internalEndpoint")

      const normalizedReplicaSlots = normalizeReplicaDependencySlots(request)
      const normalizedEndpointSlots = normalizeEndpointDependencySlots(request)

      const defaultReplicaNames = normalizedReplicaSlots
        .map(slot => slot.defaultReplicaName)
        .filter((name): name is string => name !== null)

      const uniqueDefaultReplicaNames = [...new Set(defaultReplicaNames)]

      const defaultReplicas = await prisma.replica.findMany({
        where: {
          name: {
            in: uniqueDefaultReplicaNames,
          },
        },
        select: {
          id: true,
          name: true,
        },
      })

      const defaultReplicaByName = new Map(
        defaultReplicas.map(replica => [replica.name, replica.id]),
      )

      await prisma.$transaction(async tx => {
        const replica = await tx.replica.upsert({
          where: {
            name: replicaName,
          },
          create: {
            name: replicaName,
            title,
            description,
            avatarUrl,
            internalEndpoint,
            publicEndpoint,
          },
          update: {
            title,
            description,
            avatarUrl,
            internalEndpoint,
            publicEndpoint,
          },
        })

        const requestedReplicaSlotNames = normalizedReplicaSlots.map(slot => slot.name)
        await tx.replicaDependencySlot.deleteMany({
          where: {
            replicaId: replica.id,
            name: {
              notIn: requestedReplicaSlotNames,
            },
          },
        })

        for (const slot of normalizedReplicaSlots) {
          const defaultReplicaId =
            slot.defaultReplicaName === null
              ? null
              : (defaultReplicaByName.get(slot.defaultReplicaName) ?? null)

          await tx.replicaDependencySlot.upsert({
            where: {
              replicaId_name: {
                replicaId: replica.id,
                name: slot.name,
              },
            },
            create: {
              replicaId: replica.id,
              name: slot.name,
              defaultReplicaId,
              currentReplicaId: defaultReplicaId,
            },
            update: {
              defaultReplicaId,
            },
          })
        }

        const requestedEndpointSlotNames = normalizedEndpointSlots.map(slot => slot.name)
        await tx.replicaEndpointDependencySlot.deleteMany({
          where: {
            replicaId: replica.id,
            name: {
              notIn: requestedEndpointSlotNames,
            },
          },
        })

        for (const slot of normalizedEndpointSlots) {
          await tx.replicaEndpointDependencySlot.upsert({
            where: {
              replicaId_name: {
                replicaId: replica.id,
                name: slot.name,
              },
            },
            create: {
              replicaId: replica.id,
              name: slot.name,
              defaultEndpoint: slot.defaultEndpoint,
              currentEndpoint: slot.defaultEndpoint,
            },
            update: {
              defaultEndpoint: slot.defaultEndpoint,
            },
          })
        }
      })

      return {}
    },
  }
}

type NormalizedReplicaDependencySlot = {
  name: string
  defaultReplicaName: string | null
}

type NormalizedEndpointDependencySlot = {
  name: string
  defaultEndpoint: string | null
}

function normalizeReplicaDependencySlots(
  request: RegisterReplicaRequest,
): NormalizedReplicaDependencySlot[] {
  const slots = request.replicaDependencies.map(slot => ({
    name: slot.name.trim(),
    defaultReplicaName: toNullableText(slot.defaultReplicaName),
  }))

  assertValidSlotNames(
    slots.map(slot => slot.name),
    "replicaDependencies",
  )

  return slots
}

function normalizeEndpointDependencySlots(
  request: RegisterReplicaRequest,
): NormalizedEndpointDependencySlot[] {
  const slots = request.endpointDependencies.map(slot => ({
    name: slot.name.trim(),
    defaultEndpoint: toNullableText(slot.defaultEndpoint),
  }))

  assertValidSlotNames(
    slots.map(slot => slot.name),
    "endpointDependencies",
  )

  return slots
}

function assertRequiredValue(value: string, fieldName: string): void {
  if (value.length > 0) {
    return
  }

  throw new ConnectError(`Field "${fieldName}" is required`, Code.InvalidArgument)
}

function assertValidSlotNames(slotNames: string[], fieldName: string): void {
  const uniqueSlotNames = new Set<string>()

  for (const slotName of slotNames) {
    if (slotName.length === 0) {
      throw new ConnectError(
        `Field "${fieldName}" contains slot with empty name`,
        Code.InvalidArgument,
      )
    }

    if (!uniqueSlotNames.has(slotName)) {
      uniqueSlotNames.add(slotName)
      continue
    }

    throw new ConnectError(
      `Field "${fieldName}" contains duplicate slot name "${slotName}"`,
      Code.InvalidArgument,
    )
  }
}

function toNullableText(value: string | undefined): string | null {
  if (value === undefined) {
    return null
  }

  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}
