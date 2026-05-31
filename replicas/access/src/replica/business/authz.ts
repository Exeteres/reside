import type { PrismaClient } from "../../database"
import { logger } from "@reside/common"
import { isAuthorizedByPermissionBinding } from "./permission-auth"

export async function checkPermission(
  prisma: PrismaClient,
  subjectId: string,
  permissionName: string,
  scope: string | undefined,
) {
  logger.debug(
    'authz.checkPermission subject="%s" permission="%s" scope="%s"',
    subjectId,
    permissionName,
    scope ?? "",
  )

  const authorized = await isAuthorizedByPermissionBinding(prisma, {
    permissionName,
    subjectId,
    scope,
  })

  logger.debug(
    'authz.checkPermission result for subject="%s" permission="%s": authorized=%s',
    subjectId,
    permissionName,
    authorized,
  )

  return {
    authorized,
  }
}
