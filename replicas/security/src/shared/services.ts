import type { ApprovalResponseJson } from "@reside/api/common/approval.v1"
import { status as GrpcStatus } from "@grpc/grpc-js"
import {
  createCommonServices,
  createGenericOperationService,
  createPostgresPool,
  createTemporalClient,
} from "@reside/common"
import { securityReplica } from "@reside/registry"
import { isGrpcServiceError } from "@temporalio/client"
import { PrismaClient } from "../database"
import { getApprovalWorkflowId } from "../definitions"

export async function createServices() {
  const services = await createCommonServices(securityReplica.endpoints)
  const { pool, adapter } = await createPostgresPool(services)
  const prisma = new PrismaClient({ adapter })
  const temporalClient = await createTemporalClient(services)
  const operationService = createGenericOperationService({
    prisma,
    temporalClient,
    getResult: async operationId => {
      const approvalRequest = await prisma.approvalRequest.findUnique({
        where: {
          operationId,
        },
      })

      if (approvalRequest?.result !== null && approvalRequest?.result !== undefined) {
        return {
          result: approvalRequest.result,
          resolution: approvalRequest.resolution ?? "",
        } satisfies ApprovalResponseJson
      }

      throw new Error(`Operation "${operationId}" has no approval response result`)
    },
    cancelOperation: async operationId => {
      try {
        const handle = temporalClient.workflow.getHandle(getApprovalWorkflowId(operationId))
        await handle.cancel()
      } catch (error) {
        if (isGrpcServiceError(error) && error.code === GrpcStatus.NOT_FOUND) {
          return
        }

        throw error
      }
    },
  })

  return {
    ...services,
    pool,
    prisma,
    temporalClient,
    operationService,
  }
}
