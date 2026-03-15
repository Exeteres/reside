import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type { LoadServiceImplementation } from "@reside/api/alpha/load.v1"
import type { Empty } from "@reside/api/google/protobuf/empty"
import type { PrismaClient } from "../../database"
import { status } from "@grpc/grpc-js"
import { authenticate, WellKnownPermissions } from "@reside/common"
import { wellKnownReplicaEndpoint } from "@reside/topology"
import { type CallContext, ServerError } from "nice-grpc"
import { strings } from "../../locale"

export function createLoadService(
  prisma: PrismaClient,
  getAccessAuthzService: () => AuthzServiceClient,
): LoadServiceImplementation {
  const service: LoadServiceImplementation = {
    async loadReplica(request, context: CallContext): Promise<Empty> {
      const identity = await authenticate(context)

      const name = request.name.trim()
      const image = request.image.trim()

      assertRequiredValue(name, "name")
      assertRequiredValue(image, "image")

      const accessAuthzService = getAccessAuthzService()
      const check = await accessAuthzService.checkPermission({
        permissionName: WellKnownPermissions.ALPHA_REPLICA_LOAD,
        subjectId: identity.subjectId,
        scope: name,
      })

      if (!check.authorized) {
        throw new ServerError(
          status.PERMISSION_DENIED,
          `Subject "${identity.subjectId}" cannot load replica "${name}"`,
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

  return service
}

function assertRequiredValue(value: string, fieldName: string): void {
  if (value.length > 0) {
    return
  }

  throw new ServerError(status.INVALID_ARGUMENT, `Field "${fieldName}" is required`)
}
