import type { BindingServiceImplementation } from "@reside/api/access/binding.v1"
import type { PrismaClient } from "../../database"
import { create } from "@bufbuild/protobuf"
import { TimestampSchema } from "@bufbuild/protobuf/wkt"
import { PermissionBindingSchema, PermissionRestrictionSchema } from "@reside/api/access/binding.v1"
import { authenticate } from "@reside/common"
import { listPermissionBindings, listPermissionRestrictions } from "../business/binding"

export function createBindingService({
  prisma,
}: {
  prisma: PrismaClient
}): BindingServiceImplementation {
  return {
    async listPermissionBindings(request, context) {
      await authenticate(context)

      const bindings = await listPermissionBindings(prisma, request.subjectId)
      return {
        bindings: bindings.map(binding =>
          create(PermissionBindingSchema, {
            permissionId: binding.permissionId,
            subjectId: binding.subjectId,
            scope: binding.scope ?? undefined,
            createdAt: toProtoTimestamp(binding.createdAt),
          }),
        ),
      }
    },

    async listPermissionRestrictions(request, context) {
      await authenticate(context)

      const restrictions = await listPermissionRestrictions(prisma, request.subjectId)
      return {
        restrictions: restrictions.map(restriction =>
          create(PermissionRestrictionSchema, {
            permissionId: restriction.permissionId,
            subjectId: restriction.subjectId,
            scope: restriction.scope ?? undefined,
            createdAt: toProtoTimestamp(restriction.createdAt),
          }),
        ),
      }
    },
  }
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
