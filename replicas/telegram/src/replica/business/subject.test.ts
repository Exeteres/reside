import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { rhid } from "@reside/common"
import { mockDeepFn, testCrypto } from "@reside/common/testing"
import {
  parseTelegramSubjectId,
  resolveTelegramSubjectDisplayInfo,
  toTelegramUserTitle,
} from "./subject"

process.env.REPLICA_NAME = "telegram"

describe("parseTelegramSubjectId", () => {
  test("parses telegram subject id", () => {
    expect(parseTelegramSubjectId("telegram:123")).toEqual({ userId: "123" })
  })

  test("returns null for invalid realm", () => {
    expect(parseTelegramSubjectId("other:123")).toBeNull()
  })
})

describe("toTelegramUserTitle", () => {
  test("uses username when available", () => {
    expect(toTelegramUserTitle("123", { username: "nick" } as PrismaJson.UserData)).toBe("nick")
  })

  test("falls back to first and last name", () => {
    expect(
      toTelegramUserTitle("123", {
        first_name: "John",
        last_name: "Doe",
      } as PrismaJson.UserData),
    ).toBe("John Doe")
  })
})

describe("resolveTelegramSubjectDisplayInfo", () => {
  test("loads user by parsed telegram id and returns computed title", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const telegramUserIdEcid = await testCrypto.encrypt("123")
    const usernameEcid = await testCrypto.encrypt("nick")

    prisma.user.findUnique.mockResolvedValue({
      telegramRhid: rhid("123"),
      telegramUserIdEcid,
      usernameEcid,
      firstNameEcid: null,
      lastNameEcid: null,
    } as never)

    const result = await resolveTelegramSubjectDisplayInfo(testCrypto, prisma, "telegram:123")

    expect(result.title).toBe("nick")
    expect(prisma.user.findUnique.spy()).toHaveBeenCalledTimes(1)
    expect(prisma.user.findUnique.spy()).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          telegramRhid: rhid("123"),
        },
      }),
    )
  })

  test("throws when subject id format is invalid", () => {
    const prisma = mockDeepFn<PrismaClient>()

    expect(resolveTelegramSubjectDisplayInfo(testCrypto, prisma, "invalid")).rejects.toThrow(
      'Subject ID must match format "telegram:{userId}"',
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
