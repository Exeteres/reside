import { create, type JsonObject } from "@bufbuild/protobuf"
import type {
  Operation as ApiOperation,
  GetOperationRequest,
  OperationServiceImplementation,
  OperationStatus,
  SubscribeToOperationCompletionRequest,
} from "@reside/api/common/operation.v1"
import {
  GetOperationResponseSchema,
  OperationStatus as ApiOperationStatus,
  OperationSchema,
  OperationSubscriptionService,
  SubscribeToOperationCompletionResponseSchema,
} from "@reside/api/common/operation.v1"
import { ErrorInfoSchema } from "@reside/api/google/rpc/error_details"
import { EmptySchema } from "@bufbuild/protobuf/wkt"
import type { Client } from "@temporalio/client"
import { WorkflowExecutionAlreadyStartedError, WorkflowIdReusePolicy } from "@temporalio/client"
import { Code, type HandlerContext, ConnectError } from "@connectrpc/connect"
import { createChannel, createClient } from "./api"
import { authenticate } from "./auth"
import { DEFAULT_TEMPORAL_TASK_QUEUE } from "./database/temporal"
import { getReplicaName } from "./kubernetes"
import { logger } from "./logger"
import { toProtoDateTime } from "./utils"

export type StandardOperationStatus = "PENDING" | "COMPLETED" | "FAILED"

export type StandardPrismaOperation = {
  id: number
  title: string
  description: string | null
  status: StandardOperationStatus
  failureReason: string | null
  failureMessage: string | null
  callbackEndpoint: string | null
  customData: unknown | null
  createdAt: Date
  updatedAt: Date
  resolvedAt: Date | null
}

export type OperationSubscriptionData = {
  callbackEndpoint: string
  customData: Record<string, unknown> | undefined
}

export type DuckTypedPrismaOperationClient<TOperation extends StandardPrismaOperation> = {
  operation: {
    findUnique(args: {
      where: {
        id: number
      }
    }): Promise<TOperation | null>

    update(args: {
      where: {
        id: number
      }
      data: Record<string, unknown>
    }): Promise<TOperation>
  }
}

export type GenericOperationServiceOptions<TOperation extends StandardPrismaOperation> = {
  prisma: DuckTypedPrismaOperationClient<TOperation>
  temporalClient: Client
  taskQueue?: string
  getResult?: (operationId: number) => Promise<unknown>
  cancelOperation?: (operationId: number) => Promise<void>
}

export type GenericOperationService<TOperation extends StandardPrismaOperation> = {
  implementation: OperationServiceImplementation

  activities: {
    deliverOperationCompletion: (input: DeliverOperationCompletionInput) => Promise<void>
  }

  setCompleted(
    this: void,
    operationId: number,
    extraFields?: Omit<
      Partial<TOperation>,
      | "id"
      | "title"
      | "description"
      | "status"
      | "failureReason"
      | "failureMessage"
      | "callbackEndpoint"
      | "customData"
      | "createdAt"
      | "updatedAt"
      | "resolvedAt"
    >,
  ): Promise<TOperation>

  setFailed(
    this: void,
    operationId: number,
    failureReason: string,
    failureMessage?: string,
  ): Promise<TOperation>

  toApiOperation(this: void, operationId: number): Promise<ApiOperation>
}

const OPERATION_DELIVERY_WORKFLOW_TYPE = "deliverOperationCompletionWorkflow"

type DeliverOperationCompletionInput = {
  operationId: number
}

/**
 * Creates a generic OperationService implementation on top of a standardized Prisma Operation model.
 *
 * The service reads the base operation row directly and resolves completed results lazily
 * via the provided `getResult(operationId)` callback instead of relying on relation includes.
 *
 * @param options The Prisma client and result resolver dependencies.
 * @returns The gRPC implementation and operation lifecycle helpers.
 */
export function createGenericOperationService<TOperation extends StandardPrismaOperation>(
  options: GenericOperationServiceOptions<TOperation>,
): GenericOperationService<TOperation> {
  const errorDomain = `${getReplicaName()}.reside.io`

  logger.info('creating generic operation service for replica "%s"', getReplicaName())

  return {
    activities: {
      deliverOperationCompletion: async (input: DeliverOperationCompletionInput) => {
        logger.debug(
          "deliverOperationCompletion activity started for operationId %d",
          input.operationId,
        )

        const operationRecord = await getOperationById(options.prisma, input.operationId)

        if (!operationRecord.callbackEndpoint || operationRecord.callbackEndpoint.length === 0) {
          logger.debug(
            "skipping operation completion delivery for operationId %d because callbackEndpoint is empty",
            input.operationId,
          )
          return
        }

        const operation = await mapOperationToApi(operationRecord, options.getResult, errorDomain)
        if (!isTerminalStatus(operation.status)) {
          logger.debug(
            "skipping operation completion delivery for operationId %d because status is not terminal",
            input.operationId,
          )
          return
        }

        await notifyOperationCompletionViaGrpc({
          operation,
          callbackEndpoint: operationRecord.callbackEndpoint,
          customData: toCustomDataRecord(operationRecord.customData),
        })

        logger.info("delivered operation completion for operationId %d", input.operationId)
      },
    },

    implementation: {
      async getOperation(request: GetOperationRequest, context: HandlerContext) {
        await authenticate(context)

        logger.debug("getOperation requested for operationId %d", request.operationId)

        const operationRecord = await getOperationById(options.prisma, request.operationId)

        return create(GetOperationResponseSchema, {
          operation: await mapOperationToApi(operationRecord, options.getResult, errorDomain),
        })
      },

      async subscribeToOperationCompletion(
        request: SubscribeToOperationCompletionRequest,
        context: HandlerContext,
      ) {
        await authenticate(context)

        logger.info(
          'subscribeToOperationCompletion requested for operationId %d with callbackEndpoint "%s"',
          request.operationId,
          request.callbackEndpoint,
        )

        assertCallbackEndpoint(request.callbackEndpoint)

        const operationRecord = await getOperationById(options.prisma, request.operationId)
        const operation = await mapOperationToApi(operationRecord, options.getResult, errorDomain)

        if (isTerminalStatus(operation.status)) {
          logger.info(
            "operationId %d is already terminal, returning completed operation immediately",
            request.operationId,
          )

          return create(SubscribeToOperationCompletionResponseSchema, {
            response: {
              case: "completedOperation",
              value: operation,
            },
          })
        }

        await options.prisma.operation.update({
          where: {
            id: operationRecord.id,
          },
          data: {
            callbackEndpoint: request.callbackEndpoint,
            customData: request.customData ?? null,
          },
        })

        logger.info(
          "stored operation completion subscription for operationId %d",
          request.operationId,
        )

        return create(SubscribeToOperationCompletionResponseSchema, {
          response: {
            case: "ack",
            value: create(EmptySchema),
          },
        })
      },

      async cancelOperation(request, context) {
        await authenticate(context)

        logger.info("cancelOperation requested for operationId %d", request.operationId)

        if (!options.cancelOperation) {
          throw new ConnectError(
            "Operation cancellation is not supported by this service",
            Code.Unimplemented,
          )
        }

        await options.cancelOperation(request.operationId)

        logger.info("cancelOperation completed for operationId %d", request.operationId)

        return create(EmptySchema)
      },
    },

    async setCompleted(
      operationId: number,
      extraFields?: Omit<
        Partial<TOperation>,
        | "id"
        | "title"
        | "description"
        | "status"
        | "failureReason"
        | "failureMessage"
        | "callbackEndpoint"
        | "customData"
        | "createdAt"
        | "updatedAt"
        | "resolvedAt"
      >,
    ): Promise<TOperation> {
      logger.info("marking operationId %d as COMPLETED", operationId)

      const operationRecord = await options.prisma.operation.update({
        where: {
          id: parseOperationId(operationId),
        },
        data: {
          status: "COMPLETED",
          failureReason: null,
          failureMessage: null,
          resolvedAt: new Date(),
          ...(extraFields ?? {}),
        },
      })

      await scheduleDurableNotificationDelivery(
        options.temporalClient,
        operationRecord,
        options.taskQueue,
      )

      logger.info("operationId %d marked as COMPLETED", operationId)

      return operationRecord
    },

    async setFailed(
      operationId: number,
      failureReason: string,
      failureMessage?: string,
    ): Promise<TOperation> {
      assertFailureReason(failureReason)

      logger.info("marking operationId %d as FAILED with reason %s", operationId, failureReason)

      const operationRecord = await options.prisma.operation.update({
        where: {
          id: parseOperationId(operationId),
        },
        data: {
          status: "FAILED",
          failureReason,
          failureMessage: failureMessage ?? null,
          resolvedAt: new Date(),
        },
      })

      await scheduleDurableNotificationDelivery(
        options.temporalClient,
        operationRecord,
        options.taskQueue,
      )

      logger.info("operationId %d marked as FAILED", operationId)

      return operationRecord
    },

    async toApiOperation(operationId: number): Promise<ApiOperation> {
      logger.debug("mapping operationId %d to API operation", operationId)

      const operationRecord = await getOperationById(options.prisma, operationId)

      return await mapOperationToApi(operationRecord, options.getResult, errorDomain)
    },
  }
}

export async function notifyOperationCompletionViaGrpc(args: {
  operation: ApiOperation
  callbackEndpoint: string
  customData: JsonObject | undefined
}): Promise<void> {
  const channel = createChannel(args.callbackEndpoint)

  try {
    logger.info(
      'sending operation completion notification for operationId %d to "%s"',
      args.operation.id,
      args.callbackEndpoint,
    )

    const client = createClient(OperationSubscriptionService, channel)

    await client.notifyOperationCompletion({
      operation: args.operation,
      customData: args.customData,
    })
    logger.info("operation completion notification sent for operationId %d", args.operation.id)
  } catch (error) {
    logger.error({ error }, "failed to notify operation completion via gRPC")
    throw error
  }
}

async function getOperationById<TOperation extends StandardPrismaOperation>(
  prisma: DuckTypedPrismaOperationClient<TOperation>,
  operationId: number,
): Promise<TOperation> {
  const parsedOperationId = parseOperationId(operationId)
  const operationRecord = await prisma.operation.findUnique({
    where: {
      id: parsedOperationId,
    },
  })

  if (operationRecord === null) {
    throw new ConnectError(`Operation "${operationId}" was not found`, Code.NotFound)
  }

  return operationRecord
}

async function mapOperationToApi<TOperation extends StandardPrismaOperation>(
  operationRecord: TOperation,
  getResult: ((operationId: number) => Promise<unknown>) | undefined,
  errorDomain: string,
): Promise<ApiOperation> {
  const operationId = operationRecord.id
  const status = toApiOperationStatus(operationRecord.status)

  if (status === ApiOperationStatus.COMPLETED) {
    const result = getResult ? await getResult(operationId) : undefined

    return create(OperationSchema, {
      id: operationId,
      title: operationRecord.title,
      description: operationRecord.description ?? undefined,
      status,
      createdAt: toProtoDateTime(operationRecord.createdAt),
      updatedAt: toProtoDateTime(operationRecord.updatedAt),
      resolvedAt: operationRecord.resolvedAt?.toISOString(),
      resolution: {
        case: "result",
        value: result as JsonObject,
      },
    })
  }

  if (status === ApiOperationStatus.FAILED) {
    return create(OperationSchema, {
      id: operationId,
      title: operationRecord.title,
      description: operationRecord.description ?? undefined,
      status,
      createdAt: toProtoDateTime(operationRecord.createdAt),
      updatedAt: toProtoDateTime(operationRecord.updatedAt),
      resolvedAt: operationRecord.resolvedAt?.toISOString(),
      resolution: {
        case: "error",
        value: create(ErrorInfoSchema, {
          reason: operationRecord.failureReason ?? "UNKNOWN_FAILURE",
          domain: errorDomain,
          metadata: {
            operationId: String(operationId),
            message: operationRecord.failureMessage ?? "No failure message provided",
          },
        }),
      },
    })
  }

  return create(OperationSchema, {
    id: operationId,
    title: operationRecord.title,
    description: operationRecord.description ?? undefined,
    status,
    createdAt: toProtoDateTime(operationRecord.createdAt),
    updatedAt: toProtoDateTime(operationRecord.updatedAt),
    resolvedAt: operationRecord.resolvedAt?.toISOString(),
  })
}

function assertCallbackEndpoint(callbackEndpoint: string): void {
  if (callbackEndpoint.length === 0) {
    throw new ConnectError("Callback endpoint is required", Code.InvalidArgument)
  }
}

function parseOperationId(operationId: number): number {
  if (!Number.isInteger(operationId)) {
    throw new ConnectError("Operation id is required", Code.InvalidArgument)
  }

  if (operationId < 1 || operationId > 2_147_483_647) {
    throw new ConnectError(`Invalid operation id "${operationId}"`, Code.InvalidArgument)
  }

  return operationId
}

function toApiOperationStatus(status: StandardOperationStatus): OperationStatus {
  switch (status) {
    case "PENDING":
      return ApiOperationStatus.PENDING
    case "COMPLETED":
      return ApiOperationStatus.COMPLETED
    case "FAILED":
      return ApiOperationStatus.FAILED
  }
}

function isTerminalStatus(status: OperationStatus): boolean {
  return status === ApiOperationStatus.COMPLETED || status === ApiOperationStatus.FAILED
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function assertFailureReason(failureReason: string): void {
  if (failureReason.length > 0) {
    return
  }

  throw new ConnectError("Failure reason is required", Code.InvalidArgument)
}

async function scheduleDurableNotificationDelivery<TOperation extends StandardPrismaOperation>(
  temporalClient: Client,
  operationRecord: TOperation,
  taskQueue: string | undefined,
): Promise<void> {
  if (!operationRecord.callbackEndpoint || operationRecord.callbackEndpoint.length === 0) {
    logger.debug(
      "skipping durable notification delivery scheduling for operationId %d because callbackEndpoint is empty",
      operationRecord.id,
    )
    return
  }

  if (operationRecord.status !== "COMPLETED" && operationRecord.status !== "FAILED") {
    logger.debug(
      "skipping durable notification delivery scheduling for operationId %d because status is %s",
      operationRecord.id,
      operationRecord.status,
    )
    return
  }

  try {
    logger.info(
      "scheduling durable operation completion delivery for operationId %d",
      operationRecord.id,
    )

    await temporalClient.workflow.start(OPERATION_DELIVERY_WORKFLOW_TYPE, {
      args: [
        {
          operationId: operationRecord.id,
        },
      ],
      workflowId: getOperationDeliveryWorkflowId(operationRecord),
      taskQueue: taskQueue ?? DEFAULT_TEMPORAL_TASK_QUEUE,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
    })

    logger.info(
      "scheduled durable operation completion delivery for operationId %d",
      operationRecord.id,
    )
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      logger.debug(
        "durable operation completion delivery workflow already started for operationId %d",
        operationRecord.id,
      )
      return
    }

    logger.error({ error }, "failed to schedule durable operation completion delivery")

    throw error
  }
}

function toCustomDataRecord(value: unknown | null): JsonObject | undefined {
  if (isRecord(value)) {
    return value as JsonObject
  }

  return undefined
}

function getOperationDeliveryWorkflowId<TOperation extends StandardPrismaOperation>(
  operationRecord: TOperation,
): string {
  const resolvedAt = operationRecord.resolvedAt?.getTime() ?? operationRecord.updatedAt.getTime()
  return `operation-delivery-${operationRecord.id}-${operationRecord.status}-${resolvedAt}`
}
