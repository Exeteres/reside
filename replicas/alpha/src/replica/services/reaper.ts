import type { GenericOperationService } from "@reside/common"
import type { Client as TemporalClient } from "@temporalio/client"
import type { Operation, PrismaClient } from "../../database"
import { ReaperActionHint } from "@reside/api/reaper/handler.v1"
import {
  createReaperHandler,
  DEFAULT_TEMPORAL_TASK_QUEUE,
  operationReaperAction,
  type ResideCrypto,
} from "@reside/common"
import { WorkflowExecutionAlreadyStartedError, WorkflowIdReusePolicy } from "@temporalio/client"
import { z } from "zod"
import { OperationType } from "../../database"
import { strings } from "../../locale"

const replicaPayloadSchema = z.object({
  replicaId: z.number().int().positive(),
  replicaName: z.string(),
})

export function createReaperService({
  prisma,
  temporalClient,
  operationService,
  crypto,
}: {
  prisma: PrismaClient
  temporalClient: TemporalClient
  operationService: GenericOperationService<Operation>
  crypto: ResideCrypto
}) {
  return createReaperHandler({
    crypto,
    actions: {
      unregisterReplica: {
        schema: replicaPayloadSchema,
        async execute(id, payload) {
          return operationReaperAction(
            await ensureReaperOperation({
              prisma,
              temporalClient,
              operationService,
              actionId: id,
              replicaName: payload.replicaName,
              title: strings.reaper.actions.unregister,
              type: OperationType.UNREGISTER_REPLICA,
              workflowType: "unregisterReplicaWorkflow",
            }),
          )
        },
      },
      deleteReplicaCrd: {
        schema: replicaPayloadSchema,
        async execute(id, payload) {
          return operationReaperAction(
            await ensureReaperOperation({
              prisma,
              temporalClient,
              operationService,
              actionId: id,
              replicaName: payload.replicaName,
              title: strings.reaper.actions.deleteFromCluster,
              type: OperationType.DELETE_REPLICA_FROM_CLUSTER,
              workflowType: "deleteReplicaFromClusterWorkflow",
            }),
          )
        },
      },
    },
    async preview(replicaName) {
      const replica = await prisma.replica.findUnique({
        where: {
          name: replicaName,
        },
        select: {
          id: true,
          name: true,
        },
      })

      if (replica === null) {
        return []
      }

      return [
        {
          name: "unregisterReplica" as const,
          title: strings.reaper.actions.unregister,
          hints: [ReaperActionHint.EXISTENCE, ReaperActionHint.CRITICAL],
          payload: {
            replicaId: replica.id,
            replicaName,
          },
        },
        {
          name: "deleteReplicaCrd" as const,
          title: strings.reaper.actions.deleteFromCluster,
          hints: [ReaperActionHint.CRITICAL],
          payload: {
            replicaId: replica.id,
            replicaName,
          },
        },
      ]
    },
  })
}

async function ensureReaperOperation({
  prisma,
  temporalClient,
  operationService,
  actionId,
  replicaName,
  title,
  type,
  workflowType,
}: {
  prisma: PrismaClient
  temporalClient: TemporalClient
  operationService: GenericOperationService<Operation>
  actionId: string
  replicaName: string
  title: string
  type: OperationType
  workflowType: string
}) {
  const existing = await prisma.operation.findFirst({
    where: {
      reaperActionId: actionId,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  })
  if (existing) {
    return await operationService.toApiOperation(existing.id)
  }

  const operation = await prisma.operation.create({
    data: {
      title,
      type,
      status: "PENDING",
      replicaName,
      reaperActionId: actionId,
    },
  })

  try {
    await temporalClient.workflow.start(workflowType, {
      workflowId: actionId,
      taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
      args: [{ operationId: operation.id, replicaName }],
    })
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
      await operationService.setFailed(
        operation.id,
        "REAPER_WORKFLOW_START_FAILED",
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  return await operationService.toApiOperation(operation.id)
}
