import type { GenericOperationService } from "@reside/common"
import type { Client as TemporalClient } from "@temporalio/client"
import type { Operation, PrismaClient } from "../../database"
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

const deleteDatabasePayloadSchema = z.object({
  databaseId: z.number().int().positive(),
  name: z.string(),
})

const deleteTemporalNamespacePayloadSchema = z.object({
  temporalNamespaceId: z.number().int().positive(),
  name: z.string(),
})

const deleteGatewayPayloadSchema = z.object({
  gatewayId: z.number().int().positive(),
  name: z.string(),
})

const deleteStorageBucketPayloadSchema = z.object({
  storageBucketId: z.number().int().positive(),
  name: z.string(),
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
      deleteDatabase: {
        schema: deleteDatabasePayloadSchema,
        async execute(id, payload) {
          return operationReaperAction(
            await ensureReaperOperation({
              prisma,
              temporalClient,
              operationService,
              actionId: id,
              title: strings.reaper.actions.deleteDatabase(payload.name),
              type: OperationType.DELETE_POSTGRES_DATABASE,
              relation: { postgresDatabaseId: payload.databaseId },
              workflowType: "deletePostgresDatabaseWorkflow",
            }),
          )
        },
      },
      deleteTemporalNamespace: {
        schema: deleteTemporalNamespacePayloadSchema,
        async execute(id, payload) {
          return operationReaperAction(
            await ensureReaperOperation({
              prisma,
              temporalClient,
              operationService,
              actionId: id,
              title: strings.reaper.actions.deleteTemporalNamespace(payload.name),
              type: OperationType.DELETE_TEMPORAL_NAMESPACE,
              relation: { temporalNamespaceId: payload.temporalNamespaceId },
              workflowType: "deleteTemporalNamespaceWorkflow",
            }),
          )
        },
      },
      deleteGateway: {
        schema: deleteGatewayPayloadSchema,
        async execute(id, payload) {
          return operationReaperAction(
            await ensureReaperOperation({
              prisma,
              temporalClient,
              operationService,
              actionId: id,
              title: strings.reaper.actions.deleteGateway(payload.name),
              type: OperationType.DELETE_GATEWAY,
              relation: { gatewayId: payload.gatewayId },
              workflowType: "deleteGatewayWorkflow",
            }),
          )
        },
      },
      deleteStorageBucket: {
        schema: deleteStorageBucketPayloadSchema,
        async execute(id, payload) {
          return operationReaperAction(
            await ensureReaperOperation({
              prisma,
              temporalClient,
              operationService,
              actionId: id,
              title: strings.reaper.actions.deleteStorageBucket(payload.name),
              type: OperationType.DELETE_STORAGE_BUCKET,
              relation: { storageBucketId: payload.storageBucketId },
              workflowType: "deleteStorageBucketWorkflow",
            }),
          )
        },
      },
    },
    async preview(replicaName) {
      const replicaNamespace = `replica-${replicaName}`
      const [database, temporalNamespace, storageBucket, gateways] = await Promise.all([
        prisma.postgresDatabase.findUnique({ where: { database: replicaNamespace } }),
        prisma.temporalNamespace.findUnique({ where: { namespace: replicaNamespace } }),
        prisma.storageBucket.findUnique({ where: { replicaNamespace } }),
        prisma.gateway.findMany({
          where: {
            ownerReplicaName: replicaName,
          },
          orderBy: [{ name: "asc" }],
        }),
      ])

      return [
        ...(database
          ? [
              {
                name: "deleteDatabase" as const,
                title: strings.reaper.actions.deleteDatabase(database.database),
                payload: {
                  databaseId: database.id,
                  name: database.database,
                },
              },
            ]
          : []),
        ...(temporalNamespace
          ? [
              {
                name: "deleteTemporalNamespace" as const,
                title: strings.reaper.actions.deleteTemporalNamespace(temporalNamespace.namespace),
                payload: {
                  temporalNamespaceId: temporalNamespace.id,
                  name: temporalNamespace.namespace,
                },
              },
            ]
          : []),
        ...(storageBucket
          ? [
              {
                name: "deleteStorageBucket" as const,
                title: strings.reaper.actions.deleteStorageBucket(storageBucket.bucket),
                payload: {
                  storageBucketId: storageBucket.id,
                  name: storageBucket.bucket,
                },
              },
            ]
          : []),
        ...gateways.map(gateway => ({
          name: "deleteGateway" as const,
          title: strings.reaper.actions.deleteGateway(gateway.name),
          payload: {
            gatewayId: gateway.id,
            name: gateway.name,
          },
        })),
      ]
    },
  })
}

async function ensureReaperOperation({
  prisma,
  temporalClient,
  operationService,
  actionId,
  title,
  type,
  relation,
  workflowType,
}: {
  prisma: PrismaClient
  temporalClient: TemporalClient
  operationService: GenericOperationService<Operation>
  actionId: string
  title: string
  type: OperationType
  relation: Partial<
    Pick<Operation, "postgresDatabaseId" | "temporalNamespaceId" | "gatewayId" | "storageBucketId">
  >
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
      reaperActionId: actionId,
      ...relation,
    },
  })

  try {
    await temporalClient.workflow.start(workflowType, {
      workflowId: actionId,
      taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
      args: [{ operationId: operation.id }],
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
