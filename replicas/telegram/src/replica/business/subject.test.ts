import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { mockDeepFn, testCrypto } from "@reside/common/testing"
import {
  parseTelegramSubjectId,
  resolveTelegramSubjectDisplayInfo,
  toTelegramUserTitle,
} from "./subject"

process.env.REPLICA_NAME = "telegram"

describe("parseTelegramSubjectId", () => {
  test("parses telegram subject id", () => {
    expect(parseTelegramSubjectId("telegram:123")).toEqual({ id: 123 })
  })

  test("returns null for invalid realm", () => {
    expect(parseTelegramSubjectId("other:123")).toBeNull()
  })
})

describe("toTelegramUserTitle", () => {
  test("uses username when available", () => {
    expect(toTelegramUserTitle("123", { username: "nick" })).toBe("nick")
  })

  test("falls back to first and last name", () => {
    expect(
      toTelegramUserTitle("123", {
        first_name: "John",
        last_name: "Doe",
      }),
    ).toBe("John Doe")
  })
})

describe("resolveTelegramSubjectDisplayInfo", () => {
  test("loads user by parsed telegram id and returns computed title", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const dataEcid = await testCrypto.encrypt({ username: "nick" })

    prisma.user.findUnique.mockResolvedValue({
      dataEcid,
    } as never)

    const result = await resolveTelegramSubjectDisplayInfo(testCrypto, prisma, "telegram:123")

    expect(result.title).toBe("nick")
    expect(prisma.user.findUnique.spy()).toHaveBeenCalledTimes(1)
    expect(prisma.user.findUnique.spy()).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 123,
        },
      }),
    )
  })

  test("throws when subject id format is invalid", () => {
    const prisma = mockDeepFn<PrismaClient>()

    expect(resolveTelegramSubjectDisplayInfo(testCrypto, prisma, "invalid")).rejects.toThrow(
      'Subject ID must match format "telegram:{id}"',
    )
    expect(prisma.user.findUnique.spy()).toHaveBeenCalledTimes(0)
  })

  test("throws when user is not found", () => {
    const prisma = mockDeepFn<PrismaClient>()
    prisma.user.findUnique.mockResolvedValue(null as never)

    expect(resolveTelegramSubjectDisplayInfo(testCrypto, prisma, "telegram:404")).rejects.toThrow(
      'Subject "telegram:404" was not found',
    )
    expect(prisma.user.findUnique.spy()).toHaveBeenCalledTimes(1)
  })
})
