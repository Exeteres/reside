import type { RegistrationServiceImplementation } from "@reside/api/alpha/registration.v1"
import type { PrismaClient } from "../../database"
import { authenticateReplica } from "@reside/common"
import { registerReplicaDefinition } from "../business/registration"

export function createRegistrationService({
  prisma,
}: {
  prisma: PrismaClient
}): RegistrationServiceImplementation {
  return {
    async registerReplica(request, context) {
      const identity = await authenticateReplica(context)

      await registerReplicaDefinition({
        prisma,
        replicaName: identity.name,
        request,
      })

      return {}
    },
  }
}
