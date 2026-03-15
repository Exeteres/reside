import type { GenericOperationService } from "@reside/common"
import type { Operation, PrismaClient } from "../../database"
import { CustomObjectsApi } from "@kubernetes/client-node"
import { kubeConfig } from "@reside/common"
import { strings } from "../../locale"
import {
  evaluateRegistrationReadiness,
  loadReplicaForRegistrationReadiness,
} from "../../shared/registration-readiness"

type AlphaOperationService = GenericOperationService<Operation>

export function createRegistrationActivities(
  prisma: PrismaClient,
  operationService: AlphaOperationService,
) {
  const customObjectsApi = kubeConfig.makeApiClient(CustomObjectsApi)

  return {
    async reconcileRegistrationOperation(operationId: number): Promise<"completed" | "pending"> {
      const operation = await prisma.operation.findUnique({
        where: {
          id: operationId,
        },
      })

      if (operation === null || operation.status !== "PENDING") {
        return "completed"
      }

      const replicaName = operation.replicaName
      if (replicaName === null) {
        await operationService.setFailed(
          operationId,
          "REPLICA_NOT_FOUND",
          strings.server.registration.operations.reconcileReplica.failureMessage,
        )

        return "completed"
      }

      const replica = await loadReplicaForRegistrationReadiness(prisma, replicaName)
      if (replica === null) {
        await operationService.setFailed(
          operationId,
          "REPLICA_NOT_FOUND",
          strings.server.registration.operations.reconcileReplica.failureMessage,
        )

        return "completed"
      }

      const readiness = await evaluateRegistrationReadiness(customObjectsApi, replica)
      if (!readiness.ready) {
        return "pending"
      }

      await operationService.setCompleted(operationId)
      return "completed"
    },
  }
}
