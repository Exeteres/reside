import type {
  AuthzServiceImplementation,
  CheckPermissionResponse,
} from "@reside/api/access/authz.v1"
import type { CallContext } from "nice-grpc"
import type { PrismaClient } from "../../database"
import { authenticate, logger } from "@reside/common"
import { isAuthorizedByPermissionBinding } from "./permission-auth"

export function createAuthzService(prisma: PrismaClient) {
  const service: AuthzServiceImplementation = {
    async checkPermission(request, context: CallContext): Promise<CheckPermissionResponse> {
      await authenticate(context)

      logger.debug(
        'authz.checkPermission subject="%s" permission="%s" scope="%s"',
        request.subjectId,
        request.permissionName,
        request.scope ?? "",
      )

      const authorized = await isAuthorizedByPermissionBinding(prisma, {
        permissionName: request.permissionName,
        subjectId: request.subjectId,
        scope: request.scope,
      })

      logger.debug(
        'authz.checkPermission result for subject="%s" permission="%s": authorized=%s',
        request.subjectId,
        request.permissionName,
        authorized,
      )

      return {
        authorized,
      }
    },
  }

  return service
}
