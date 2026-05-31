import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { mockDeepFn } from "@reside/common/testing"
import { putApprover, putPermissions, putRealm } from "./definition"

describe("definition business", () => {
  test("putPermissions checks manage permission per unique name and upserts permissions", async () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.permission.findUnique.mockResolvedValue({ id: 1, scoped: true } as never)
    prisma.permissionBinding.findUnique.mockResolvedValue({ id: 10 } as never)
    prisma.permissionBinding.findFirst.mockResolvedValue(null as never)

    prisma.permission.upsert.mockResolvedValue({
      id: 100,
      name: "perm.a",
      title: "Perm A",
      description: null,
      scoped: true,
    } as never)

    const result = await putPermissions(prisma, "replica:alpha", [
      {
        name: "perm.a",
        title: "Perm A",
        description: undefined,
        scoped: true,
      },
      {
        name: "perm.a",
        title: "Perm A2",
        description: "desc",
        scoped: true,
      },
    ])

    expect(prisma.permission.findUnique.spy()).toHaveBeenCalledTimes(1)
    expect(prisma.permission.upsert.spy()).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(2)
  })

  test("putRealm throws when manager permission is missing", () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.permission.findUnique.mockResolvedValue({ id: 1, scoped: true } as never)
    prisma.permissionBinding.findUnique.mockResolvedValue(null as never)
    prisma.permissionBinding.findFirst.mockResolvedValue(null as never)

    expect(
      putRealm(prisma, "replica:alpha", {
        name: "telegram",
        title: "Telegram",
        description: undefined,
        subjectServiceEndpoint: undefined,
      }),
    ).rejects.toThrow('lacks "access:realm:manage"')
  })

  test("putApprover validates input and normalizes realms", async () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.permission.findUnique.mockResolvedValue({ id: 1, scoped: true } as never)
    prisma.permissionBinding.findUnique.mockResolvedValue({ id: 10 } as never)
    prisma.permissionBinding.findFirst.mockResolvedValue(null as never)

    prisma.realm.findMany.mockResolvedValue([{ name: "alpha" }, { name: "telegram" }] as never)
    prisma.approver.upsert.mockResolvedValue({
      id: 5,
      name: "auto-approver",
      priority: 1,
      realms: [
        {
          id: 1,
          name: "alpha",
          title: "Alpha",
          description: null,
          subjectServiceEndpoint: null,
        },
      ],
      title: "Approver",
      description: null,
      callbackEndpoint: "http://example/callback",
    } as never)

    await putApprover(prisma, "alpha", {
      name: "auto-approver",
      priority: 1,
      realms: [" telegram ", "alpha", "alpha"],
      title: "Approver",
      description: undefined,
      callbackEndpoint: "http://example/callback",
    })

    expect(prisma.realm.findMany.spy()).toHaveBeenCalledWith({
      where: {
        name: {
          in: ["alpha", "telegram"],
        },
      },
      select: {
        name: true,
      },
    })
  })

  test("putApprover throws for invalid name", () => {
    const prisma = mockDeepFn<PrismaClient>()

    expect(
      putApprover(prisma, "alpha", {
        name: "Bad Name",
        priority: 1,
        realms: ["alpha"],
        title: "Approver",
        description: undefined,
        callbackEndpoint: "http://example/callback",
      }),
    ).rejects.toThrow('Approver name must match "name" format')
  })
})
