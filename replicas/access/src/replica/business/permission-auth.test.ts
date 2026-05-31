import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { mockDeepFn } from "@reside/common/testing"
import { isAuthorizedByPermissionBinding } from "./permission-auth"

describe("isAuthorizedByPermissionBinding", () => {
  test("throws when permission is not found", () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.permission.findUnique.mockResolvedValue(null as never)

    expect(
      isAuthorizedByPermissionBinding(prisma, {
        permissionName: "perm.read",
        subjectId: "telegram:1",
        scope: undefined,
      }),
    ).rejects.toThrow('Permission "perm.read" was not found')
  })

  test("throws when scoped permission is checked without scope", () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.permission.findUnique.mockResolvedValue({ id: 1, scoped: true } as never)

    expect(
      isAuthorizedByPermissionBinding(prisma, {
        permissionName: "perm.read",
        subjectId: "telegram:1",
        scope: undefined,
      }),
    ).rejects.toThrow('Permission "perm.read" requires scope descriptor')
  })

  test("throws when unscoped permission is checked with scope", () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.permission.findUnique.mockResolvedValue({ id: 1, scoped: false } as never)

    expect(
      isAuthorizedByPermissionBinding(prisma, {
        permissionName: "perm.read",
        subjectId: "telegram:1",
        scope: "alerts",
      }),
    ).rejects.toThrow('Permission "perm.read" is not scoped and does not accept scope descriptor')
  })

  test("returns true for scoped check when global binding exists", async () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.permission.findUnique.mockResolvedValue({ id: 1, scoped: true } as never)
    prisma.permissionBinding.findUnique.mockResolvedValue(null as never)
    prisma.permissionBinding.findFirst.mockResolvedValue({ id: 10 } as never)

    const authorized = await isAuthorizedByPermissionBinding(prisma, {
      permissionName: "perm.read",
      subjectId: "telegram:1",
      scope: "alerts",
    })

    expect(authorized).toBeTrue()
  })

  test("returns false for unscoped check when binding does not exist", async () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.permission.findUnique.mockResolvedValue({ id: 1, scoped: false } as never)
    prisma.permissionBinding.findFirst.mockResolvedValue(null as never)

    const authorized = await isAuthorizedByPermissionBinding(prisma, {
      permissionName: "perm.read",
      subjectId: "telegram:1",
      scope: undefined,
    })

    expect(authorized).toBeFalse()
  })
})
