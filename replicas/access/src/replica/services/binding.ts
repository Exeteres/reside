import type {
  BindingServiceImplementation,
  PermissionBinding,
  PermissionRestriction,
} from "@reside/api/access/binding.v1"
import type { PrismaClient } from "../../database"
import { create } from "@bufbuild/protobuf"
import { TimestampSchema } from "@bufbuild/protobuf/wkt"
import { PermissionBindingSchema, PermissionRestrictionSchema } from "@reside/api/access/binding.v1"
import { authenticate, logger } from "@reside/common"

export function createBindingService({
  prisma,
}: {
  prisma: PrismaClient
}): BindingServiceImplementation {
  return {
    async listPermissionBindings(request, context) {
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

    async listPermissionRestrictions(request, context) {
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
}

function toPermissionBindingResponse(binding: {
  permissionId: number
  subjectId: string
  scope: string | null
  createdAt: Date
}): PermissionBinding {
  return create(PermissionBindingSchema, {
    permissionId: binding.permissionId,
    subjectId: binding.subjectId,
    scope: binding.scope ?? undefined,
    createdAt: toProtoTimestamp(binding.createdAt),
  })
}

function toPermissionRestrictionResponse(restriction: {
  permissionId: number
  subjectId: string
  scope: string | null
  createdAt: Date
}): PermissionRestriction {
  return create(PermissionRestrictionSchema, {
    permissionId: restriction.permissionId,
    subjectId: restriction.subjectId,
    scope: restriction.scope ?? undefined,
    createdAt: toProtoTimestamp(restriction.createdAt),
  })
}

function toProtoTimestamp(value: Date) {
  const milliseconds = value.getTime()
  const seconds = Math.floor(milliseconds / 1000)
  const nanos = (milliseconds % 1000) * 1_000_000

  return create(TimestampSchema, {
    seconds: BigInt(seconds),
    nanos,
  })
}
