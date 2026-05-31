import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { mockDeepFn } from "@reside/common/testing"
import { checkPermission } from "./authz"

describe("checkPermission", () => {
  test("returns authorized=true when binding exists", async () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.permission.findUnique.mockResolvedValue({ id: 1, scoped: false } as never)
    prisma.permissionBinding.findFirst.mockResolvedValue({ id: 10 } as never)

    const result = await checkPermission(prisma, "replica:alpha", "access:realm:manage", undefined)

    expect(result).toEqual({
      authorized: true,
    })
  })

  test("returns authorized=false when binding is missing", async () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.permission.findUnique.mockResolvedValue({ id: 1, scoped: false } as never)
    prisma.permissionBinding.findFirst.mockResolvedValue(null as never)

    const result = await checkPermission(prisma, "replica:alpha", "access:realm:manage", undefined)

    expect(result).toEqual({
      authorized: false,
    })
  })
})
