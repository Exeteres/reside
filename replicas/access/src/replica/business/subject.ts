import type { PrismaClient } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"
import { WellKnownPermissions } from "@reside/registry"
import { isAuthorizedByPermissionBinding } from "./permission-auth"

const SUBJECT_READ_PERMISSION_NAME = WellKnownPermissions.ACCESS_SUBJECT_READ

export async function getSubjectDisplayInfo(
  prisma: PrismaClient,
  requesterSubjectId: string,
  requestedSubjectId: string,
) {
  const parsedSubjectId = parseSubjectId(requestedSubjectId)

  if (parsedSubjectId === null) {
    throw new ConnectError('Subject ID must match format "{realm}:{name}"', Code.InvalidArgument)
  }

  const authorized = await isAuthorizedByPermissionBinding(prisma, {
    permissionName: SUBJECT_READ_PERMISSION_NAME,
    subjectId: requesterSubjectId,
    scope: parsedSubjectId.realmName,
  })

  if (!authorized) {
    throw new ConnectError(
      `Subject "${requesterSubjectId}" lacks "${SUBJECT_READ_PERMISSION_NAME}" for scope "${parsedSubjectId.realmName}"`,
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

  return {
    subjectServiceEndpoint: realm.subjectServiceEndpoint,
    subjectId: requestedSubjectId,
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
