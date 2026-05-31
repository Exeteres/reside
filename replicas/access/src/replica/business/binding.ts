import type { PrismaClient } from "../../database"
import { logger } from "@reside/common"

export type PermissionBindingRecord = {
  permissionId: number
  subjectId: string
  scope: string | null
  createdAt: Date
}

export type PermissionRestrictionRecord = {
  permissionId: number
  subjectId: string
  scope: string | null
  createdAt: Date
}

export async function listPermissionBindings(prisma: PrismaClient, subjectId: string) {
  logger.debug('binding.listPermissionBindings subject="%s"', subjectId)

  const bindings = await prisma.permissionBinding.findMany({
    where: {
      subjectId,
    },
    orderBy: [
      {
        permissionId: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
  })

  return bindings satisfies PermissionBindingRecord[]
}

export async function listPermissionRestrictions(prisma: PrismaClient, subjectId: string) {
  logger.debug('binding.listPermissionRestrictions subject="%s"', subjectId)

  const restrictions = await prisma.permissionRestriction.findMany({
    where: {
      subjectId,
    },
    orderBy: [
      {
        permissionId: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
  })

  return restrictions satisfies PermissionRestrictionRecord[]
}
