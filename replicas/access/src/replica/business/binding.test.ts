import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { mockDeepFn } from "@reside/common/testing"
import { listPermissionBindings, listPermissionRestrictions } from "./binding"

describe("binding business", () => {
  test("listPermissionBindings queries by subject and returns records", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const createdAt = new Date("2026-01-01T00:00:00.000Z")

    prisma.permissionBinding.findMany.mockResolvedValue([
      {
        permissionId: 7,
        subjectId: "telegram:1",
        scope: "alerts",
        createdAt,
      },
    ] as never)

    const result = await listPermissionBindings(prisma, "telegram:1")

    expect(prisma.permissionBinding.findMany.spy()).toHaveBeenCalledWith({
      where: {
        subjectId: "telegram:1",
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

    expect(result).toHaveLength(1)
    expect(result[0]?.permissionId).toBe(7)
    expect(result[0]?.subjectId).toBe("telegram:1")
    expect(result[0]?.scope).toBe("alerts")
    expect(result[0]?.createdAt).toEqual(createdAt)
  })

  test("listPermissionRestrictions queries by subject and returns records", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const createdAt = new Date("2026-01-01T00:00:00.000Z")

    prisma.permissionRestriction.findMany.mockResolvedValue([
      {
        permissionId: 11,
        subjectId: "telegram:1",
        scope: null,
        createdAt,
      },
    ] as never)

    const result = await listPermissionRestrictions(prisma, "telegram:1")

    expect(prisma.permissionRestriction.findMany.spy()).toHaveBeenCalledWith({
      where: {
        subjectId: "telegram:1",
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

    expect(result).toHaveLength(1)
    expect(result[0]?.permissionId).toBe(11)
    expect(result[0]?.subjectId).toBe("telegram:1")
    expect(result[0]?.scope).toBeNull()
    expect(result[0]?.createdAt).toEqual(createdAt)
  })
})
