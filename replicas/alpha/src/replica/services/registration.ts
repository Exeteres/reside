import type { RegistrationServiceImplementation } from "@reside/api/alpha/registration.v1"
import type { Client } from "@temporalio/client"
import type { PrismaClient } from "../../database"
import { authenticateReplica } from "@reside/common"
import {
  registerReplicaDefinition,
  startReplicaReleaseNotesWorkflow,
} from "../business/registration"

export function createRegistrationService({
  prisma,
  temporalClient,
}: {
  prisma: PrismaClient
  temporalClient: Client
}): RegistrationServiceImplementation {
  return {
    async registerReplica(request, context) {
      const identity = await authenticateReplica(context)

      const result = await registerReplicaDefinition({
        prisma,
        replicaName: identity.name,
        request,
      })

      if (result.releaseNotes !== null) {
        await startReplicaReleaseNotesWorkflow(temporalClient, result.releaseNotes)
      }

      return {}
    },
  }
}
