import type {
  SubjectServiceClient,
  SubjectServiceImplementation,
} from "@reside/api/common/subject.v1"
import type { PrismaClient } from "../../database"
import { SubjectService } from "@reside/api/common/subject.v1"
import { authenticate, createChannel, createClient } from "@reside/common"
import { getSubjectDisplayInfo } from "../business/subject"

export function createSubjectService({
  prisma,
}: {
  prisma: PrismaClient
}): SubjectServiceImplementation {
  const clientsByEndpoint = new Map<string, SubjectServiceClient>()

  function getSubjectServiceClient(endpoint: string): SubjectServiceClient {
    const cachedClient = clientsByEndpoint.get(endpoint)
    if (cachedClient) {
      return cachedClient
    }

    const nextClient = createClient(SubjectService, createChannel(endpoint))
    clientsByEndpoint.set(endpoint, nextClient)
    return nextClient
  }

  return {
    async getSubjectDisplayInfo(request, context) {
      const identity = await authenticate(context)
      const payload = await getSubjectDisplayInfo(prisma, identity.subjectId, request.subjectId)

      return await getSubjectServiceClient(payload.subjectServiceEndpoint).getSubjectDisplayInfo({
        subjectId: payload.subjectId,
      })
    },
  }
}
