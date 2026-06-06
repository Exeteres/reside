import type { PrismaClient } from "../../database"
import type { ReplicaManagementActivities } from "../../definitions"
import { CoreV1Api } from "@kubernetes/client-node"
import { kubeConfig } from "@reside/common"
import { NodeNotFoundError, ReplicaNotFoundError } from "../../definitions"
import { isNotFoundError } from "../../shared/replica-crd"

type ReplicaManagementActivityServices = {
  prisma: PrismaClient
}

export function createReplicaManagementActivities({
  prisma,
}: ReplicaManagementActivityServices): ReplicaManagementActivities {
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)

  return {
    async listRegisteredReplicas() {
      const replicas = await prisma.replica.findMany({
        select: {
          name: true,
          title: true,
          description: true,
          image: true,
          internalEndpoint: true,
          publicEndpoint: true,
          node: true,
          version: true,
          changes: true,
        },
        orderBy: [{ title: "asc" }, { name: "asc" }],
      })

      return {
        replicas,
      }
    },

    async setReplicaNode({ replicaName, nodeName }) {
      const replica = await prisma.replica.findUnique({
        where: {
          name: replicaName,
        },
        select: {
          id: true,
        },
      })

      if (replica === null) {
        throw new ReplicaNotFoundError(replicaName)
      }

      try {
        await coreApi.readNode({
          name: nodeName,
        })
      } catch (error) {
        if (isNotFoundError(error)) {
          throw new NodeNotFoundError(nodeName)
        }

        throw error
      }

      await prisma.replica.update({
        where: {
          id: replica.id,
        },
        data: {
          node: nodeName,
        },
      })
    },

    async resetReplicaNode({ replicaName }) {
      const replica = await prisma.replica.findUnique({
        where: {
          name: replicaName,
        },
        select: {
          id: true,
        },
      })

      if (replica === null) {
        throw new ReplicaNotFoundError(replicaName)
      }

      await prisma.replica.update({
        where: {
          id: replica.id,
        },
        data: {
          node: null,
        },
      })
    },
  }
}
