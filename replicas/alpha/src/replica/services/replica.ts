import type { ReplicaServiceImplementation } from "@reside/api/alpha/replica.v1"
import type { PrismaClient } from "../../database"
import { authenticateReplica } from "@reside/common"
import { getReplicaInfo, listReplicaInfos } from "../business/replica"

export function createReplicaService({
  prisma,
}: {
  prisma: PrismaClient
}): ReplicaServiceImplementation {
  return {
    async listReplicas(_request, context) {
      await authenticateReplica(context)

      return await listReplicaInfos(prisma)
    },
    async getReplica(request, context) {
      await authenticateReplica(context)

      const name = request.name?.trim() ?? ""
      if (name.length === 0) {
        return { replica: undefined }
      }

      return await getReplicaInfo(prisma, name)
    },
  }
}
