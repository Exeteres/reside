import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { mockDeepFn } from "@reside/common/testing"
import { getSubjectDisplayInfo } from "./subject"

describe("getSubjectDisplayInfo", () => {
  test("throws for invalid subject id format", () => {
    const prisma = mockDeepFn<PrismaClient>()

    expect(getSubjectDisplayInfo(prisma, "replica:alpha", "invalid")).rejects.toThrow(
      'Subject ID must match format "{realm}:{name}"',
    )
  })

  test("throws when requester lacks read permission", () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.permission.findUnique.mockResolvedValue({ id: 1, scoped: true } as never)
    prisma.permissionBinding.findUnique.mockResolvedValue(null as never)
    prisma.permissionBinding.findFirst.mockResolvedValue(null as never)

    expect(getSubjectDisplayInfo(prisma, "replica:alpha", "telegram:user1")).rejects.toThrow(
      'lacks "access:subject:read"',
    )
  })

  test("throws when realm does not exist", () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.permission.findUnique.mockResolvedValue({ id: 1, scoped: true } as never)
    prisma.permissionBinding.findUnique.mockResolvedValue({ id: 10 } as never)
    prisma.permissionBinding.findFirst.mockResolvedValue(null as never)
    prisma.realm.findUnique.mockResolvedValue(null as never)

    expect(getSubjectDisplayInfo(prisma, "replica:alpha", "telegram:user1")).rejects.toThrow(
      'Realm "telegram" was not found',
    )
  })

  test("returns endpoint and subject id on success", async () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.permission.findUnique.mockResolvedValue({ id: 1, scoped: true } as never)
    prisma.permissionBinding.findUnique.mockResolvedValue({ id: 10 } as never)
    prisma.permissionBinding.findFirst.mockResolvedValue(null as never)
    prisma.realm.findUnique.mockResolvedValue({
      subjectServiceEndpoint: "http://subject-service",
    } as never)

    const result = await getSubjectDisplayInfo(prisma, "replica:alpha", "telegram:user1")

    expect(result).toEqual({
      subjectServiceEndpoint: "http://subject-service",
      subjectId: "telegram:user1",
    })
  })
})
