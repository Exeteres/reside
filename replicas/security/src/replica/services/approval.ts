import type { ApprovalServiceImplementation } from "@reside/api/common/approval.v1"
import type { GenericOperationService } from "@reside/common"
import type { Client } from "@temporalio/client"
import type { Operation, PrismaClient } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"
import { authenticateReplica, logger } from "@reside/common"
import { createApprovalRequest } from "../business"

type ApprovalServiceServices = {
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
  temporalClient: Client
}

export function createApprovalService({
  prisma,
  operationService,
  temporalClient,
}: ApprovalServiceServices): ApprovalServiceImplementation {
  return {
    async approve(request, context) {
      const identity = await authenticateReplica(context)
      if (identity.name !== "access") {
        throw new ConnectError(
          "Only access replica may call approval endpoint",
          Code.PermissionDenied,
        )
      }

      logger.info("creating security approval workflow")

      const created = await createApprovalRequest(
        prisma,
        temporalClient,
        request.title,
        request.content,
      )

      logger.info("security approval workflow started operationId=%d", created.operationId)

      return await operationService.toApiOperation(created.operationId)
    },
  }
}
