import type { PrismaClient } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"
import { DEFAULT_TEMPORAL_TASK_QUEUE } from "@reside/common"
import { wellKnownReplicaEndpoint } from "@reside/registry"
import {
  type Client,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdReusePolicy,
} from "@temporalio/client"
import { OperationType } from "../../database"
import { strings } from "../../locale"

export async function upsertLoadedReplicaAndCreateOperation({
  prisma,
  temporalClient,
  name,
  image,
}: {
  prisma: PrismaClient
  temporalClient: Client
  name: string
  image: string
}) {
  await prisma.replica.upsert({
    where: {
      name,
    },
    create: {
      name,
      title: strings.server.load.unknownReplicaTitle,
      description: null,
      avatarUrl: null,
      image,
      internalEndpoint: wellKnownReplicaEndpoint(name),
      publicEndpoint: null,
    },
    update: {
      image,
    },
  })

  const operation = await prisma.operation.create({
    data: {
      title: strings.server.load.operations.reconcileReplica.title,
      description: strings.server.load.operations.reconcileReplica.description,
      type: OperationType.WAIT_REPLICA_READY,
      status: "PENDING",
      replicaName: name,
    },
  })

  await startReplicaReadinessWorkflow(temporalClient, operation.id)

  return operation
}

export async function startReplicaReadinessWorkflow(
  temporalClient: Client,
  operationId: number,
): Promise<void> {
  try {
    await temporalClient.workflow.start("waitForReplicaRegistrationWorkflow", {
      args: [operationId],
      workflowId: `wait-replica-ready-${operationId}`,
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

    throw new ConnectError("Failed to schedule replica readiness workflow", Code.Internal)
  }
}

export function assertRequiredValue(value: string, fieldName: string): void {
  if (value.length > 0) {
    return
  }

  throw new ConnectError(`Field "${fieldName}" is required`, Code.InvalidArgument)
}
