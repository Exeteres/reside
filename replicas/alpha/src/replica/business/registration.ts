import type { RegisterReplicaRequest } from "@reside/api/alpha/registration.v1"
import type { PrismaClient } from "../../database"
import type { NotifyReplicaReleaseNotesWorkflowInput } from "../../definitions"
import { Code, ConnectError } from "@connectrpc/connect"
import { DEFAULT_TEMPORAL_TASK_QUEUE } from "@reside/common"
import {
  type Client,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdReusePolicy,
} from "@temporalio/client"

const RELEASE_NOTES_WORKFLOW_TYPE = "notifyReplicaReleaseNotesWorkflow"

export type RegisterReplicaDefinitionOutput = {
  releaseNotes: NotifyReplicaReleaseNotesWorkflowInput | null
}

export async function registerReplicaDefinition({
  prisma,
  replicaName,
  request,
}: {
  prisma: PrismaClient
  replicaName: string
  request: RegisterReplicaRequest
}): Promise<RegisterReplicaDefinitionOutput> {
  const title = request.title.trim()
  const description = toNullableText(request.description)
  const avatarUrl = toNullableText(request.avatarUrl)
  const internalEndpoint = request.internalEndpoint.trim()
  const publicEndpoint = toNullableText(request.publicEndpoint)
  const version = toNullableText(request.version)
  const changes = toNullableText(request.changes)

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

  const defaultReplicaByName = new Map(defaultReplicas.map(replica => [replica.name, replica.id]))

  let releaseNotes: NotifyReplicaReleaseNotesWorkflowInput | null = null

  await prisma.$transaction(async tx => {
    const existingReplica = await tx.replica.findUnique({
      where: {
        name: replicaName,
      },
      select: {
        version: true,
        changes: true,
      },
    })

    const nextChanges = resolveNextChanges({
      previousVersion: existingReplica?.version ?? null,
      previousChanges: existingReplica?.changes ?? null,
      nextVersion: version,
      requestedChanges: changes,
    })

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
        version,
        changes: nextChanges,
      },
      update: {
        title,
        description,
        avatarUrl,
        internalEndpoint,
        publicEndpoint,
        version,
        changes: nextChanges,
      },
    })

    if (
      version !== null &&
      ((existingReplica === null && version.length > 0) || existingReplica?.version !== version)
    ) {
      releaseNotes = {
        replicaName,
        replicaTitle: title,
        oldVersion: existingReplica?.version ?? null,
        newVersion: version,
        changes: nextChanges,
      }
    }

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

  return {
    releaseNotes,
  }
}

function resolveNextChanges(args: {
  previousVersion: string | null
  previousChanges: string | null
  nextVersion: string | null
  requestedChanges: string | null
}): string | null {
  if (args.nextVersion === null) {
    return null
  }

  if (args.previousVersion === null) {
    return args.requestedChanges
  }

  if (args.previousVersion !== args.nextVersion) {
    return args.requestedChanges
  }

  // keep stored changes for unchanged versions, ignore newly reported changes
  return args.previousChanges
}

export async function startReplicaReleaseNotesWorkflow(
  temporalClient: Client,
  input: NotifyReplicaReleaseNotesWorkflowInput,
): Promise<void> {
  try {
    await temporalClient.workflow.start(RELEASE_NOTES_WORKFLOW_TYPE, {
      args: [input],
      workflowId: `notify-replica-release-notes-${input.replicaName}-${input.newVersion}`,
      taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
    })

    return
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      return
    }

    if (error instanceof Error) {
      throw new ConnectError(error.message, Code.Internal)
    }

    throw new ConnectError("Failed to schedule replica release notes workflow", Code.Internal)
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

export function normalizeReplicaDependencySlots(
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

export function normalizeEndpointDependencySlots(
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

export function assertRequiredValue(value: string, fieldName: string): void {
  if (value.length > 0) {
    return
  }

  throw new ConnectError(`Field "${fieldName}" is required`, Code.InvalidArgument)
}

export function assertValidSlotNames(slotNames: string[], fieldName: string): void {
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

export function toNullableText(value: string | undefined): string | null {
  if (value === undefined) {
    return null
  }

  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}
