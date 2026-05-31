import type { DiscoveryServiceImplementation } from "@reside/api/alpha/discovery.v1"
import type { PrismaClient } from "../../database"
import { authenticateReplica } from "@reside/common"
import { resolveEffectiveEndpoints, resolveSubjectEndpointBySubjectId } from "../business/discovery"

export function createDiscoveryService({
  prisma,
}: {
  prisma: PrismaClient
}): DiscoveryServiceImplementation {
  return {
    async getEffectiveEndpoints(_request, context) {
      const identity = await authenticateReplica(context)

      return await resolveEffectiveEndpoints(prisma, identity.name)
    },

    async getSubjectEndpoint(request, context) {
      await authenticateReplica(context)

      return await resolveSubjectEndpointBySubjectId(prisma, request.subjectId)
    },
  }
}
