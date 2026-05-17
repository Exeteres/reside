import type { LoadServiceImplementation } from "@reside/api/alpha/load.v1"
import type { PrismaClient } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"
import { authenticate, type CommonServices } from "@reside/common"
import { WellKnownPermissions, wellKnownReplicaEndpoint } from "@reside/registry"
import { strings } from "../../locale"

export function createLoadService({
  prisma,
  authzService,
}: CommonServices<"access"> & {
  prisma: PrismaClient
}): LoadServiceImplementation {
  return {
    async loadReplica(request, context) {
      const identity = await authenticate(context)

      const name = request.name.trim()
      const image = request.image.trim()

      assertRequiredValue(name, "name")
      assertRequiredValue(image, "image")

      const check = await authzService.checkPermission({
        permissionName: WellKnownPermissions.ALPHA_REPLICA_LOAD,
        subjectId: identity.subjectId,
        scope: name,
      })

      if (!check.authorized) {
        throw new ConnectError(
          `Subject "${identity.subjectId}" cannot load replica "${name}"`,
          Code.PermissionDenied,
        )
      }

      await prisma.replica.upsert({
        where: {
          name,
        },
        create: {
          name,
          title: strings.server.load.unknownReplicaTitle,
          description: null,
          avatarUrl: null,
          image,
          internalEndpoint: wellKnownReplicaEndpoint(name),
          publicEndpoint: null,
        },
        update: {
          image,
        },
      })

      return {}
    },
  }
}

function assertRequiredValue(value: string, fieldName: string): void {
  if (value.length > 0) {
    return
  }

  throw new ConnectError(`Field "${fieldName}" is required`, Code.InvalidArgument)
}
