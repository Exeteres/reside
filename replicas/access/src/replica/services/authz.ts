import type { AuthzServiceImplementation } from "@reside/api/access/authz.v1"
import type { PrismaClient } from "../../database"
import { authenticate } from "@reside/common"
import { checkPermission } from "../business/authz"

export function createAuthzService({
  prisma,
}: {
  prisma: PrismaClient
}): AuthzServiceImplementation {
  return {
    async checkPermission(request, context) {
      await authenticate(context)

      return await checkPermission(prisma, request.subjectId, request.permissionName, request.scope)
    },
  }
}
