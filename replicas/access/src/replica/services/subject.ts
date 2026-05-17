import type {
  SubjectServiceClient,
  SubjectServiceImplementation,
} from "@reside/api/common/subject.v1"
import type { PrismaClient } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"
import { SubjectService } from "@reside/api/common/subject.v1"
import { authenticate, createChannel, createClient } from "@reside/common"
import { WellKnownPermissions } from "@reside/registry"
import { isAuthorizedByPermissionBinding } from "./permission-auth"

const SUBJECT_READ_PERMISSION_NAME = WellKnownPermissions.ACCESS_SUBJECT_READ

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
      const parsedSubjectId = parseSubjectId(request.subjectId)

      if (parsedSubjectId === null) {
        throw new ConnectError(
          'Subject ID must match format "{realm}:{name}"',
          Code.InvalidArgument,
        )
      }

      const authorized = await isAuthorizedByPermissionBinding(prisma, {
        permissionName: SUBJECT_READ_PERMISSION_NAME,
        subjectId: identity.subjectId,
        scope: parsedSubjectId.realmName,
      })

      if (!authorized) {
        throw new ConnectError(
          `Subject "${identity.subjectId}" lacks "${SUBJECT_READ_PERMISSION_NAME}" for scope "${parsedSubjectId.realmName}"`,
          Code.PermissionDenied,
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
        throw new ConnectError(`Realm "${parsedSubjectId.realmName}" was not found`, Code.NotFound)
      }

      if (realm.subjectServiceEndpoint === null || realm.subjectServiceEndpoint.length === 0) {
        throw new ConnectError(
          `Realm "${parsedSubjectId.realmName}" has no subject service endpoint`,
          Code.FailedPrecondition,
        )
      }

      return await getSubjectServiceClient(realm.subjectServiceEndpoint).getSubjectDisplayInfo({
        subjectId: request.subjectId,
      })
    },
  }
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
