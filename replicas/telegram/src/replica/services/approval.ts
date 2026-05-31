import type { ApprovalServiceImplementation } from "@reside/api/common/approval.v1"
import type { GenericOperationService } from "@reside/common"
import type { Client } from "@temporalio/client"
import type { Operation, PrismaClient } from "../../database"
import { authenticate, logger } from "@reside/common"
import { createApprovalRequest } from "../business/approval"

export function createApprovalService(services: {
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
  temporalClient: Client
}): ApprovalServiceImplementation {
  return {
    async approve(request, context) {
      const { subjectId } = await authenticate(context)

      logger.info("creating telegram approval request workflow")

      const result = await createApprovalRequest(
        services.prisma,
        services.temporalClient,
        subjectId,
        request.title,
        request.content,
      )

      logger.info("started telegram approval workflow for operationId %d", result.operationId)

      return await services.operationService.toApiOperation(result.operationId)
    },
  }
}
