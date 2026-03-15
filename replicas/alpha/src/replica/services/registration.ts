import type {
  RegisterReplicaRequest,
  RegisterReplicaResponse,
  RegistrationServiceImplementation,
} from "@reside/api/alpha/registration.v1"
import type { GenericOperationService } from "@reside/common"
import type { Client } from "@temporalio/client"
import type { Operation, PrismaClient } from "../../database"
import { status } from "@grpc/grpc-js"
import { CustomObjectsApi } from "@kubernetes/client-node"
import { authenticateReplica, getReplicaNamespace, kubeConfig } from "@reside/common"
import { WorkflowExecutionAlreadyStartedError, WorkflowIdReusePolicy } from "@temporalio/client"
import { type CallContext, ServerError } from "nice-grpc"
import { strings } from "../../locale"
import {
  evaluateRegistrationReadiness,
  loadReplicaForRegistrationReadiness,
} from "../../shared/registration-readiness"

const REGISTRATION_WORKFLOW_TYPE = "waitForReplicaRegistrationWorkflow"

type AlphaOperationService = GenericOperationService<Operation>

export function createRegistrationService(
  prisma: PrismaClient,
  temporalClient: Client,
  operationService: AlphaOperationService,
): RegistrationServiceImplementation {
  const customObjectsApi = kubeConfig.makeApiClient(CustomObjectsApi)

  const service: RegistrationServiceImplementation = {
    async registerReplica(
      request: RegisterReplicaRequest,
      context: CallContext,
    ): Promise<RegisterReplicaResponse> {
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

      const replica = await loadReplicaForRegistrationReadiness(prisma, replicaName)
      if (replica === null) {
        throw new ServerError(status.NOT_FOUND, `Replica "${replicaName}" was not found`)
      }

      const readiness = await evaluateRegistrationReadiness(customObjectsApi, replica)
      if (readiness.ready) {
        return {
          operation: undefined,
        }
      }

      const existingOperation = await prisma.operation.findFirst({
        where: {
          replicaName,
          status: "PENDING",
        },
        orderBy: {
          createdAt: "desc",
        },
      })

      if (existingOperation !== null) {
        return {
          operation: await operationService.toApiOperation(existingOperation.id),
        }
      }

      const operation = await prisma.operation.create({
        data: {
          title: strings.server.registration.operations.reconcileReplica.title,
          description: strings.server.registration.operations.reconcileReplica.description,
          status: "PENDING",
          replicaName,
        },
      })

      await startRegistrationWorkflow(temporalClient, operation.id)

      return {
        operation: await operationService.toApiOperation(operation.id),
      }
    },
  }

  return service
}

async function startRegistrationWorkflow(
  temporalClient: Client,
  operationId: number,
): Promise<void> {
  const workflowId = String(operationId)

  try {
    await temporalClient.workflow.start(REGISTRATION_WORKFLOW_TYPE, {
      args: [operationId],
      workflowId,
      taskQueue: getReplicaNamespace(),
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
    })

    return
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      return
    }

    if (error instanceof Error) {
      throw new ServerError(status.INTERNAL, error.message)
    }

    throw new ServerError(status.INTERNAL, "Failed to schedule registration workflow")
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

  throw new ServerError(status.INVALID_ARGUMENT, `Field "${fieldName}" is required`)
}

function assertValidSlotNames(slotNames: string[], fieldName: string): void {
  const uniqueSlotNames = new Set<string>()

  for (const slotName of slotNames) {
    if (slotName.length === 0) {
      throw new ServerError(
        status.INVALID_ARGUMENT,
        `Field "${fieldName}" contains slot with empty name`,
      )
    }

    if (!uniqueSlotNames.has(slotName)) {
      uniqueSlotNames.add(slotName)
      continue
    }

    throw new ServerError(
      status.INVALID_ARGUMENT,
      `Field "${fieldName}" contains duplicate slot name "${slotName}"`,
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
