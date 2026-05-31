import type { PrismaClient } from "../../database"
import {
  isAuthorizedByPermissionBinding as isAuthorizedByPermissionBindingBusiness,
  type PermissionAuthorizationRequest,
} from "../business/permission-auth"

export type { PermissionAuthorizationRequest }

export async function isAuthorizedByPermissionBinding(
  prisma: PrismaClient,
  request: PermissionAuthorizationRequest,
): Promise<boolean> {
  return await isAuthorizedByPermissionBindingBusiness(prisma, request)
}
