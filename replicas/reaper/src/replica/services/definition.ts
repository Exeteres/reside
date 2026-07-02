import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type { DefinitionServiceImplementation } from "@reside/api/reaper/definition.v1"
import type { PrismaClient } from "../../database"
import { create } from "@bufbuild/protobuf"
import { Code, ConnectError } from "@connectrpc/connect"
import { PutHandlersResponseSchema, ReaperHandlerSchema } from "@reside/api/reaper/definition.v1"
import { authenticateReplica } from "@reside/common"
import { WellKnownPermissions } from "@reside/registry"
import { putReaperHandlers } from "../business"

export function createDefinitionService({
  prisma,
  authzService,
}: {
  prisma: PrismaClient
  authzService: AuthzServiceClient
}): DefinitionServiceImplementation {
  return {
    async putHandlers(request, context) {
      const identity = await authenticateReplica(context)
      const uniqueResourceReplicaNames = [
        ...new Set(request.handlers.map(handler => handler.resourceReplicaName.trim())),
      ]

      for (const resourceReplicaName of uniqueResourceReplicaNames) {
        const permission = await authzService.checkPermission({
          permissionName: WellKnownPermissions.REAPER_HANDLER_REGISTER,
          subjectId: identity.subjectId,
          scope: resourceReplicaName,
        })

        if (!permission.authorized) {
          throw new ConnectError(
            `Subject "${identity.subjectId}" is not allowed to register reaper handler for "${resourceReplicaName}"`,
            Code.PermissionDenied,
          )
        }
      }

      const handlers = await putReaperHandlers(
        prisma,
        request.handlers.map(handler => ({
          resourceReplicaName: handler.resourceReplicaName,
          title: handler.title,
          callbackEndpoint: handler.callbackEndpoint,
        })),
      )

      return create(PutHandlersResponseSchema, {
        handlers: handlers.map(handler =>
          create(ReaperHandlerSchema, {
            id: handler.id,
            resourceReplicaName: handler.resourceReplicaName,
            title: handler.title,
            callbackEndpoint: handler.callbackEndpoint,
          }),
        ),
      })
    },
  }
}
