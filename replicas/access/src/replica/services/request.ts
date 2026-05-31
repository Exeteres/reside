import type { PermissionRequestServiceImplementation } from "@reside/api/access/request.v1"
import type { GenericOperationService } from "@reside/common"
import type { Client } from "@temporalio/client"
import type { Operation as AccessOperation, PrismaClient } from "../../database"
import { authenticate } from "@reside/common"
import { requestPermissions } from "../business/request"

export function createPermissionRequestService({
  prisma,
  operationService,
  temporalClient,
}: {
  prisma: PrismaClient
  operationService: GenericOperationService<AccessOperation>
  temporalClient: Client
}): PermissionRequestServiceImplementation {
  return {
    async requestPermissions(request, context) {
      const { subjectId } = await authenticate(context)

      return await requestPermissions(prisma, operationService, temporalClient, subjectId, {
        subjectId: request.subjectId,
        permissionSetName: request.permissionSetName,
        reason: request.reason,
        items: request.items.map(item => ({
          permissionName: item.permissionName,
          scope: item.scope,
        })),
      })
    },
  }
}
