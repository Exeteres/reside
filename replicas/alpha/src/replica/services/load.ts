import type { LoadServiceImplementation } from "@reside/api/alpha/load.v1"
import type { Client } from "@temporalio/client"
import type { Operation, PrismaClient } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"
import { authenticate, type CommonServices, type GenericOperationService } from "@reside/common"
import { WellKnownPermissions } from "@reside/registry"
import { assertRequiredValue, upsertLoadedReplicaAndCreateOperation } from "../business/load"

export function createLoadService({
  prisma,
  authzService,
  operationService,
  temporalClient,
}: CommonServices<"access"> & {
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
  temporalClient: Client
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

      const operation = await upsertLoadedReplicaAndCreateOperation({
        prisma,
        temporalClient,
        name,
        image,
      })

      return {
        operation: await operationService.toApiOperation(operation.id),
      }
    },
  }
}
