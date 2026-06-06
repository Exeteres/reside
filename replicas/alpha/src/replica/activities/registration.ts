import type { AvatarServiceClient } from "@reside/api/interaction/avatar.v1"
import type { GenericOperationService } from "@reside/common"
import type { Operation, PrismaClient } from "../../database"
import type { RegistrationActivities } from "../../definitions"
import { CustomObjectsApi } from "@kubernetes/client-node"
import { kubeConfig } from "@reside/common"
import { strings } from "../../locale"
import {
  evaluateRegistrationReadiness,
  loadReplicaForRegistrationReadiness,
} from "../../shared/registration-readiness"

type RegistrationActivityServices = {
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
  avatarService: AvatarServiceClient
}

export function createRegistrationActivities({
  prisma,
  operationService,
  avatarService,
}: RegistrationActivityServices): RegistrationActivities {
  const customObjectsApi = kubeConfig.makeApiClient(CustomObjectsApi)

  return {
    async reconcileRegistrationOperation({ operationId }) {
      const operation = await prisma.operation.findUnique({
        where: {
          id: operationId,
        },
      })

      if (operation === null || operation.status !== "PENDING") {
        return {
          status: "completed",
        }
      }

      const replicaName = operation.replicaName
      if (replicaName === null) {
        await operationService.setFailed(
          operationId,
          "REPLICA_NOT_FOUND",
          strings.server.registration.operations.reconcileReplica.failureMessage,
        )

        return {
          status: "completed",
        }
      }

      const replica = await loadReplicaForRegistrationReadiness(prisma, replicaName)
      if (replica === null) {
        await operationService.setFailed(
          operationId,
          "REPLICA_NOT_FOUND",
          strings.server.registration.operations.reconcileReplica.failureMessage,
        )

        return {
          status: "completed",
        }
      }

      const readiness = await evaluateRegistrationReadiness(customObjectsApi, replica)
      if (!readiness.ready) {
        return {
          status: "pending",
        }
      }

      await operationService.setCompleted(operationId)
      return {
        status: "completed",
      }
    },

    async updateReplicaAvatarVersionTag({ replicaName, newVersion }) {
      await avatarService.updateAvatarVersion({
        replicaName,
        newVersion,
      })
    },
  }
}
