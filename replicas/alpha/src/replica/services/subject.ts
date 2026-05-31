import type { SubjectServiceImplementation } from "@reside/api/common/subject.v1"
import type { PrismaClient } from "../../database"
import { authenticateReplica } from "@reside/common"
import {
  assertSubjectDisplayQueryReplica,
  resolveReplicaSubjectDisplayInfo,
} from "../business/subject"

export function createSubjectService({
  prisma,
}: {
  prisma: PrismaClient
}): SubjectServiceImplementation {
  return {
    async getSubjectDisplayInfo(request, context) {
      const identity = await authenticateReplica(context)
      assertSubjectDisplayQueryReplica(identity.name)

      return await resolveReplicaSubjectDisplayInfo(prisma, request.subjectId)
    },
  }
}
