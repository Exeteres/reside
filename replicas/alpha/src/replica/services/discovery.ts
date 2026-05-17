import type { DiscoveryServiceImplementation } from "@reside/api/alpha/discovery.v1"
import type { PrismaClient } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"
import { authenticateReplica } from "@reside/common"
import { resolveDesiredReplicaEndpoints } from "../../shared/replica-crd"

export function createDiscoveryService({
  prisma,
}: {
  prisma: PrismaClient
}): DiscoveryServiceImplementation {
  return {
    async getEffectiveEndpoints(_request, context) {
      const identity = await authenticateReplica(context)

      const replica = await prisma.replica.findUnique({
        where: {
          name: identity.name,
        },
        select: {
          name: true,
          image: true,
          replicaDependencySlots: {
            select: {
              name: true,
              currentReplica: {
                select: {
                  internalEndpoint: true,
                },
              },
            },
          },
          endpointDependencySlots: {
            select: {
              name: true,
              defaultEndpoint: true,
              currentEndpoint: true,
            },
          },
        },
      })

      if (replica === null) {
        throw new ConnectError(
          `Replica "${identity.name}" is not registered in alpha`,
          Code.NotFound,
        )
      }

      return {
        endpoints: resolveDesiredReplicaEndpoints(replica),
      }
    },
  }
}
