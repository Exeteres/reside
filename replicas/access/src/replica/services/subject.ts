import type {
  GetSubjectDisplayInfoRequest,
  SubjectDisplayInfo,
  SubjectServiceClient,
  SubjectServiceImplementation,
} from "@reside/api/common/subject.v1"
import type { PrismaClient } from "../../database"
import { status } from "@grpc/grpc-js"
import { createChannel } from "@reside/api"
import { SubjectServiceDefinition } from "@reside/api/common/subject.v1"
import { authenticate, createClient, WellKnownPermissions } from "@reside/common"
import { type CallContext, ServerError } from "nice-grpc"
import { isAuthorizedByPermissionBinding } from "./permission-auth"

const SUBJECT_READ_PERMISSION_NAME = WellKnownPermissions.ACCESS_SUBJECT_READ

export function createSubjectService(prisma: PrismaClient): SubjectServiceImplementation {
  const clientsByEndpoint = new Map<string, SubjectServiceClient>()

  function getSubjectServiceClient(endpoint: string): SubjectServiceClient {
    const cachedClient = clientsByEndpoint.get(endpoint)
    if (cachedClient) {
      return cachedClient
    }

    const nextClient = createClient(SubjectServiceDefinition, createChannel(endpoint))
    clientsByEndpoint.set(endpoint, nextClient)
    return nextClient
  }

  const service: SubjectServiceImplementation = {
    async getSubjectDisplayInfo(
      request: GetSubjectDisplayInfoRequest,
      context: CallContext,
    ): Promise<SubjectDisplayInfo> {
      const identity = await authenticate(context)
      const parsedSubjectId = parseSubjectId(request.subjectId)

      if (parsedSubjectId === null) {
        throw new ServerError(
          status.INVALID_ARGUMENT,
          'Subject ID must match format "{realm}:{name}"',
        )
      }

      const authorized = await isAuthorizedByPermissionBinding(prisma, {
        permissionName: SUBJECT_READ_PERMISSION_NAME,
        subjectId: identity.subjectId,
        scope: parsedSubjectId.realmName,
      })

      if (!authorized) {
        throw new ServerError(
          status.PERMISSION_DENIED,
          `Subject "${identity.subjectId}" lacks "${SUBJECT_READ_PERMISSION_NAME}" for scope "${parsedSubjectId.realmName}"`,
        )
      }

      const realm = await prisma.realm.findUnique({
        where: {
          name: parsedSubjectId.realmName,
        },
        select: {
          subjectServiceEndpoint: true,
        },
      })

      if (realm === null) {
        throw new ServerError(
          status.NOT_FOUND,
          `Realm "${parsedSubjectId.realmName}" was not found`,
        )
      }

      if (realm.subjectServiceEndpoint === null || realm.subjectServiceEndpoint.length === 0) {
        throw new ServerError(
          status.FAILED_PRECONDITION,
          `Realm "${parsedSubjectId.realmName}" has no subject service endpoint`,
        )
      }

      return await getSubjectServiceClient(realm.subjectServiceEndpoint).getSubjectDisplayInfo({
        subjectId: request.subjectId,
      })
    },
  }

  return service
}

function parseSubjectId(subjectId: string): { realmName: string; subjectName: string } | null {
  const segments = subjectId.trim().split(":")
  if (segments.length !== 2) {
    return null
  }

  const realmName = segments[0]
  const subjectName = segments[1]
  if (!realmName || !subjectName) {
    return null
  }

  return {
    realmName,
    subjectName,
  }
}
