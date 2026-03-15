import type {
  BindingServiceImplementation,
  ListPermissionBindingsRequest,
  ListPermissionBindingsResponse,
  ListPermissionRestrictionsRequest,
  ListPermissionRestrictionsResponse,
  PermissionBinding,
  PermissionRestriction,
} from "@reside/api/access/binding.v1"
import type { CallContext } from "nice-grpc"
import type { PrismaClient } from "../../database"
import { authenticate, logger } from "@reside/common"

export function createBindingService(prisma: PrismaClient) {
  const service: BindingServiceImplementation = {
    async listPermissionBindings(
      request: ListPermissionBindingsRequest,
      context: CallContext,
    ): Promise<ListPermissionBindingsResponse> {
      await authenticate(context)

      logger.debug('binding.listPermissionBindings subject="%s"', request.subjectId)

      const bindings = await prisma.permissionBinding.findMany({
        where: {
          subjectId: request.subjectId,
        },
        orderBy: [
          {
            permissionId: "asc",
          },
          {
            createdAt: "asc",
          },
        ],
      })

      return {
        bindings: bindings.map(toPermissionBindingResponse),
      }
    },

    async listPermissionRestrictions(
      request: ListPermissionRestrictionsRequest,
      context: CallContext,
    ): Promise<ListPermissionRestrictionsResponse> {
      await authenticate(context)

      logger.debug('binding.listPermissionRestrictions subject="%s"', request.subjectId)

      const restrictions = await prisma.permissionRestriction.findMany({
        where: {
          subjectId: request.subjectId,
        },
        orderBy: [
          {
            permissionId: "asc",
          },
          {
            createdAt: "asc",
          },
        ],
      })

      return {
        restrictions: restrictions.map(toPermissionRestrictionResponse),
      }
    },
  }

  return service
}

function toPermissionBindingResponse(binding: {
  permissionId: number
  subjectId: string
  scope: string | null
  createdAt: Date
}): PermissionBinding {
  return {
    permissionId: binding.permissionId,
    subjectId: binding.subjectId,
    scope: binding.scope ?? undefined,
    createdAt: binding.createdAt,
  }
}

function toPermissionRestrictionResponse(restriction: {
  permissionId: number
  subjectId: string
  scope: string | null
  createdAt: Date
}): PermissionRestriction {
  return {
    permissionId: restriction.permissionId,
    subjectId: restriction.subjectId,
    scope: restriction.scope ?? undefined,
    createdAt: restriction.createdAt,
  }
}
