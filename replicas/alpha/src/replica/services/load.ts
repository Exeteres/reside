import type { LoadServiceImplementation } from "@reside/api/alpha/load.v1"
import type { Operation, PrismaClient } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"
import {
  authenticate,
  type CommonServices,
  DEFAULT_TEMPORAL_TASK_QUEUE,
  type GenericOperationService,
} from "@reside/common"
import { WellKnownPermissions, wellKnownReplicaEndpoint } from "@reside/registry"
import {
  type Client,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdReusePolicy,
} from "@temporalio/client"
import { strings } from "../../locale"

export function createLoadService({
  prisma,
  authzService,
  operationService,
  temporalClient,
}: CommonServices<"access"> & {
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
  temporalClient: Client
}): LoadServiceImplementation {
  return {
    async loadReplica(request, context) {
      const identity = await authenticate(context)

      const name = request.name.trim()
      const image = request.image.trim()

      assertRequiredValue(name, "name")
      assertRequiredValue(image, "image")

      const check = await authzService.checkPermission({
        permissionName: WellKnownPermissions.ALPHA_REPLICA_LOAD,
        subjectId: identity.subjectId,
        scope: name,
      })

      if (!check.authorized) {
        throw new ConnectError(
          `Subject "${identity.subjectId}" cannot load replica "${name}"`,
          Code.PermissionDenied,
        )
      }

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
          status: "PENDING",
          replicaName: name,
        },
      })

      await startReplicaReadinessWorkflow(temporalClient, operation.id)

      return {
        operation: await operationService.toApiOperation(operation.id),
      }
    },
  }
}

async function startReplicaReadinessWorkflow(
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

function assertRequiredValue(value: string, fieldName: string): void {
  if (value.length > 0) {
    return
  }

  throw new ConnectError(`Field "${fieldName}" is required`, Code.InvalidArgument)
}
