import type { CustomObjectsApi } from "@kubernetes/client-node"
import type { PrismaClient } from "../database"
import type { ReplicaForDesiredEndpoints } from "./replica-crd"
import { readReplicaCrd, resolveDesiredReplicaEndpoints } from "./replica-crd"

export type RegistrationReadinessStatus =
  | {
      ready: true
    }
  | {
      ready: false
      reason:
        | "CRD_NOT_FOUND"
        | "CRD_NOT_READY"
        | "IMAGE_MISMATCH"
        | "ENDPOINT_MISMATCH"
        | "REPLICA_WITHOUT_IMAGE"
    }

export async function loadReplicaForRegistrationReadiness(
  prisma: PrismaClient,
  replicaName: string,
): Promise<ReplicaForDesiredEndpoints | null> {
  return await prisma.replica.findUnique({
    where: {
      name: replicaName,
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
}

export async function evaluateRegistrationReadiness(
  customObjectsApi: CustomObjectsApi,
  replica: ReplicaForDesiredEndpoints,
): Promise<RegistrationReadinessStatus> {
  if (replica.image === null) {
    return {
      ready: false,
      reason: "REPLICA_WITHOUT_IMAGE",
    }
  }

  const desiredEndpoints = resolveDesiredReplicaEndpoints(replica)
  const replicaCrd = await readReplicaCrd(customObjectsApi, replica.name)

  if (!replicaCrd.exists) {
    return {
      ready: false,
      reason: "CRD_NOT_FOUND",
    }
  }

  if (!replicaCrd.ready) {
    return {
      ready: false,
      reason: "CRD_NOT_READY",
    }
  }

  if (replicaCrd.image !== replica.image) {
    return {
      ready: false,
      reason: "IMAGE_MISMATCH",
    }
  }

  for (const [endpointName, endpoint] of Object.entries(desiredEndpoints)) {
    if (replicaCrd.endpoints[endpointName] !== endpoint) {
      return {
        ready: false,
        reason: "ENDPOINT_MISMATCH",
      }
    }
  }

  return {
    ready: true,
  }
}
