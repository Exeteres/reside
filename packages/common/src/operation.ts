import type {
  Operation as ApiOperation,
  GetOperationRequest,
  GetOperationResponse,
  OperationServiceClient,
  OperationServiceImplementation,
  OperationStatus,
  SubscribeToOperationCompletionRequest,
  SubscribeToOperationCompletionResponse,
} from "@reside/api/common/operation.v1"
import type { ProvisionServiceClient } from "@reside/api/database/provision.v1"
import { status as grpcStatus } from "@grpc/grpc-js"
import { createChannel } from "@reside/api"
import {
  OperationStatus as ApiOperationStatus,
  Operation,
  OperationSubscriptionServiceDefinition,
} from "@reside/api/common/operation.v1"
import { Empty } from "@reside/api/google/protobuf/empty"
import { ErrorInfo } from "@reside/api/google/rpc/error_details"
import type { Client } from "@temporalio/client"
import { WorkflowExecutionAlreadyStartedError, WorkflowIdReusePolicy } from "@temporalio/client"
import { type CallContext, ServerError } from "nice-grpc"
import { createClient } from "./api"
import { authenticate } from "./auth"
import { startTemporalWorker as runTemporalWorker } from "./database/temporal"
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
  getResult: (operationId: number) => Promise<unknown>
  cancelOperation?: (operationId: number) => Promise<void>
}

export type StartOperationWorkerArgs = {
  provisionService: ProvisionServiceClient
  operationService: OperationServiceClient
  taskQueue?: string
}

export type GenericOperationService<TOperation extends StandardPrismaOperation> = {
  implementation: OperationServiceImplementation

  startOperationWorker(this: void, args: StartOperationWorkerArgs): Promise<void>

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
  const defaultOperationTaskQueue = `${getReplicaName()}-operations`
  let operationTaskQueue = defaultOperationTaskQueue

  logger.info('creating generic operation service for replica "%s"', getReplicaName())

  return {
    async startOperationWorker(args: StartOperationWorkerArgs): Promise<void> {
      operationTaskQueue = args.taskQueue ?? defaultOperationTaskQueue

      logger.info('starting operation worker with task queue "%s"', operationTaskQueue)

      await runTemporalWorker({
        provisionService: args.provisionService,
        operationService: args.operationService,
        taskQueue: operationTaskQueue,
        activities: {
          deliverOperationCompletion: async (input: DeliverOperationCompletionInput) => {
            logger.debug(
              "deliverOperationCompletion activity started for operationId %d",
              input.operationId,
            )

            const operationRecord = await getOperationById(options.prisma, input.operationId)

            if (
              !operationRecord.callbackEndpoint ||
              operationRecord.callbackEndpoint.length === 0
            ) {
              logger.debug(
                "skipping operation completion delivery for operationId %d because callbackEndpoint is empty",
                input.operationId,
              )
              return
            }

            const operation = await mapOperationToApi(
              operationRecord,
              options.getResult,
              errorDomain,
            )
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
      })
    },

    implementation: {
      async getOperation(
        request: GetOperationRequest,
        context: CallContext,
      ): Promise<GetOperationResponse> {
        await authenticate(context)

        logger.debug("getOperation requested for operationId %d", request.operationId)

        const operationRecord = await getOperationById(options.prisma, request.operationId)

        return {
          operation: await mapOperationToApi(operationRecord, options.getResult, errorDomain),
        }
      },

      async subscribeToOperationCompletion(
        request: SubscribeToOperationCompletionRequest,
        context: CallContext,
      ): Promise<SubscribeToOperationCompletionResponse> {
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

          return {
            response: {
              $case: "completedOperation",
              value: operation,
            },
          }
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

        return {
          response: {
            $case: "ack",
            value: Empty.create({}),
          },
        }
      },

      async cancelOperation(request: GetOperationRequest, context: CallContext): Promise<Empty> {
        await authenticate(context)

        logger.info("cancelOperation requested for operationId %d", request.operationId)

        if (!options.cancelOperation) {
          throw new ServerError(
            grpcStatus.UNIMPLEMENTED,
            "Operation cancellation is not supported by this service",
          )
        }

        await options.cancelOperation(request.operationId)

        logger.info("cancelOperation completed for operationId %d", request.operationId)

        return Empty.create({})
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
        operationTaskQueue,
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
        operationTaskQueue,
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
  customData: Record<string, unknown> | undefined
}): Promise<void> {
  const channel = createChannel(args.callbackEndpoint)

  try {
    logger.info(
      'sending operation completion notification for operationId %d to "%s"',
      args.operation.id,
      args.callbackEndpoint,
    )

    const client = createClient(OperationSubscriptionServiceDefinition, channel)

    await client.notifyOperationCompletion({
      operation: args.operation,
      customData: args.customData,
    })
    logger.info("operation completion notification sent for operationId %d", args.operation.id)
  } catch (error) {
    logger.error({ error }, "failed to notify operation completion via gRPC")
    throw error
  } finally {
    channel.close()
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
    throw new ServerError(grpcStatus.NOT_FOUND, `Operation "${operationId}" was not found`)
  }

  return operationRecord
}

async function mapOperationToApi<TOperation extends StandardPrismaOperation>(
  operationRecord: TOperation,
  getResult: (operationId: number) => Promise<unknown>,
  errorDomain: string,
): Promise<ApiOperation> {
  const operationId = operationRecord.id
  const status = toApiOperationStatus(operationRecord.status)

  if (status === ApiOperationStatus.COMPLETED) {
    const result = await getResult(operationId)

    return Operation.create({
      id: operationId,
      title: operationRecord.title,
      description: operationRecord.description ?? undefined,
      status,
      createdAt: toProtoDateTime(operationRecord.createdAt),
      updatedAt: toProtoDateTime(operationRecord.updatedAt),
      resolvedAt: operationRecord.resolvedAt?.toISOString(),
      resolution: {
        $case: "result",
        value: result,
      },
    })
  }

  if (status === ApiOperationStatus.FAILED) {
    return Operation.create({
      id: operationId,
      title: operationRecord.title,
      description: operationRecord.description ?? undefined,
      status,
      createdAt: toProtoDateTime(operationRecord.createdAt),
      updatedAt: toProtoDateTime(operationRecord.updatedAt),
      resolvedAt: operationRecord.resolvedAt?.toISOString(),
      resolution: {
        $case: "error",
        value: ErrorInfo.create({
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

  return Operation.create({
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
    throw new ServerError(grpcStatus.INVALID_ARGUMENT, "Callback endpoint is required")
  }
}

function parseOperationId(operationId: number): number {
  if (!Number.isInteger(operationId)) {
    throw new ServerError(grpcStatus.INVALID_ARGUMENT, "Operation id is required")
  }

  if (operationId < 1 || operationId > 2_147_483_647) {
    throw new ServerError(grpcStatus.INVALID_ARGUMENT, `Invalid operation id "${operationId}"`)
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

  throw new ServerError(grpcStatus.INVALID_ARGUMENT, "Failure reason is required")
}

async function scheduleDurableNotificationDelivery<TOperation extends StandardPrismaOperation>(
  temporalClient: Client,
  operationRecord: TOperation,
  taskQueue: string,
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
      taskQueue,
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

function toCustomDataRecord(value: unknown | null): Record<string, unknown> | undefined {
  if (isRecord(value)) {
    return value
  }

  return undefined
}

function getOperationDeliveryWorkflowId<TOperation extends StandardPrismaOperation>(
  operationRecord: TOperation,
): string {
  const resolvedAt = operationRecord.resolvedAt?.getTime() ?? operationRecord.updatedAt.getTime()
  return `operation-delivery-${operationRecord.id}-${operationRecord.status}-${resolvedAt}`
}
