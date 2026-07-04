import type { Client as TemporalClient } from "@temporalio/client"
import type { PrismaClient } from "../../database"
import { randomUUID } from "node:crypto"
import { defineTool, getReplicaName } from "@reside/common"
import { z } from "zod"
import { startResetReplicaNodeCommand, startSetReplicaNodeCommand } from "../business"

type ReplicasToolServices = {
  prisma: PrismaClient
}

export function createReplicasTool({ prisma }: ReplicasToolServices) {
  return defineTool("reside_replicas", {
    description: "Returns registered replicas with routing and placement details.",
    parameters: z.object({}),
    handler: async () => {
      const replicas = await prisma.replica.findMany({
        select: {
          name: true,
          title: true,
          description: true,
          image: true,
          internalEndpoint: true,
          publicEndpoint: true,
          node: true,
        },
        orderBy: [{ title: "asc" }, { name: "asc" }],
      })

      return {
        replicas,
      }
    },
  })
}

type ReplicaNodeToolServices = {
  temporalClient: TemporalClient
}

export function createSetReplicaNodeTool({ temporalClient }: ReplicaNodeToolServices) {
  return defineTool("reside_set_replica_node", {
    description: "Pins a replica to a specific Kubernetes node.",
    parameters: z.object({
      replica: z.string().min(1),
      node: z.string().min(1),
    }),
    handler: async ({ replica, node }) => {
      const invocationId = randomUUID()
      const replicaName = replica.trim()
      const nodeName = node.trim()
      const subjectId = `replica:${getReplicaName()}`

      await startSetReplicaNodeCommand(
        temporalClient,
        invocationId,
        subjectId,
        replicaName,
        nodeName,
      )

      return {
        invocationId,
        status: "started",
        response: `Started command reside_set_replica_node for replica ${replicaName}.`,
      }
    },
  })
}

export function createResetReplicaNodeTool({ temporalClient }: ReplicaNodeToolServices) {
  return defineTool("reside_reset_replica_node", {
    description: "Removes node pinning for a replica.",
    parameters: z.object({
      replica: z.string().min(1),
    }),
    handler: async ({ replica }) => {
      const invocationId = randomUUID()
      const replicaName = replica.trim()
      const subjectId = `replica:${getReplicaName()}`

      await startResetReplicaNodeCommand(temporalClient, invocationId, subjectId, replicaName)

      return {
        invocationId,
        status: "started",
        response: `Started command reside_reset_replica_node for replica ${replicaName}.`,
      }
    },
  })
}

type AlphaNlsToolServices = {
  temporalClient: TemporalClient
  prisma: PrismaClient
}

export function createAlphaNlsTools({ temporalClient, prisma }: AlphaNlsToolServices) {
  return [
    createReplicasTool({ prisma }),
    createSetReplicaNodeTool({ temporalClient }),
    createResetReplicaNodeTool({ temporalClient }),
  ]
}
