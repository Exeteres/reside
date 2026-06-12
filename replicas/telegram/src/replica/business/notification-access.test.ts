import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { rhid } from "@reside/common"
import { mockDeepFn, testCrypto } from "@reside/common/testing"
import { createInteractionContextToken } from "../../shared"
import {
  ensureTargetChatExists,
  parseInteractionContextToken,
  resolveSenderDisplayTitle,
  resolveSenderSubjectId,
} from "./notification-access"

describe("resolveSenderSubjectId", () => {
  test("returns caller subject id when requested subject is missing", async () => {
    const authzService = mockDeepFn<{
      checkPermission(args: {
        permissionName: string
        subjectId: string
        scope: string
      }): Promise<{ authorized: boolean }>
    }>()

    const resolved = await resolveSenderSubjectId(authzService, "replica:demo", undefined)

    expect(resolved).toBe("replica:demo")
    expect(authzService.checkPermission.spy()).toHaveBeenCalledTimes(0)
  })

  test("throws when requested subject is empty", async () => {
    const authzService = mockDeepFn<{
      checkPermission(args: {
        permissionName: string
        subjectId: string
        scope: string
      }): Promise<{ authorized: boolean }>
    }>()

    expect(resolveSenderSubjectId(authzService, "replica:demo", "   ")).rejects.toThrow(
      "sendAsSubjectId must not be empty",
    )
  })

  test("throws when caller is not allowed to send as requested subject", async () => {
    const authzService = mockDeepFn<{
      checkPermission(args: {
        permissionName: string
        subjectId: string
        scope: string
      }): Promise<{ authorized: boolean }>
    }>()
    authzService.checkPermission.mockResolvedValue({ authorized: false } as never)

    expect(resolveSenderSubjectId(authzService, "replica:demo", "replica:other")).rejects.toThrow(
      "is not allowed to send notifications as subject",
    )
  })

  test("returns requested id without authz when caller matches requested id", async () => {
    const authzService = mockDeepFn<{
      checkPermission(args: {
        permissionName: string
        subjectId: string
        scope: string
      }): Promise<{ authorized: boolean }>
    }>()

    const resolved = await resolveSenderSubjectId(authzService, "replica:demo", "replica:demo")

    expect(resolved).toBe("replica:demo")
    expect(authzService.checkPermission.spy()).toHaveBeenCalledTimes(0)
  })
})

describe("resolveSenderDisplayTitle", () => {
  test("returns resolved title when access returns non-empty title", async () => {
    const subjectService = mockDeepFn<{
      getSubjectDisplayInfo(args: { subjectId: string }): Promise<{ title: string }>
    }>()
    subjectService.getSubjectDisplayInfo.mockResolvedValue({ title: "Display" } as never)

    const title = await resolveSenderDisplayTitle(subjectService, "replica:demo", "Fallback")

    expect(title).toBe("Display")
  })

  test("returns fallback title when access call fails", async () => {
    const subjectService = mockDeepFn<{
      getSubjectDisplayInfo(args: { subjectId: string }): Promise<{ title: string }>
    }>()
    subjectService.getSubjectDisplayInfo.mockRejectedValue(new Error("boom"))

    const title = await resolveSenderDisplayTitle(subjectService, "replica:demo", "Fallback")

    expect(title).toBe("Fallback")
  })

  test("returns fallback title when access returns empty title", async () => {
    const subjectService = mockDeepFn<{
      getSubjectDisplayInfo(args: { subjectId: string }): Promise<{ title: string }>
    }>()
    subjectService.getSubjectDisplayInfo.mockResolvedValue({ title: "" } as never)

    const title = await resolveSenderDisplayTitle(subjectService, "replica:demo", "Fallback")

    expect(title).toBe("Fallback")
  })
})

describe("parseInteractionContextToken", () => {
  test("returns system chat id for missing token", async () => {
    const context = await parseInteractionContextToken(testCrypto, undefined, "-1001")

    expect(context).toEqual({
      chatId: "-1001",
      messageId: undefined,
    })
  })

  test("parses encrypted interaction context token", async () => {
    const token = await createInteractionContextToken(testCrypto, {
      chat_id: "-222",
      message_id: 77,
    })

    const context = await parseInteractionContextToken(testCrypto, token, "-1001")

    expect(context).toEqual({
      chatId: "-222",
      messageId: 77,
    })
  })

  test("throws for invalid context token", async () => {
    expect(parseInteractionContextToken(testCrypto, "not-a-valid-token", "-1001")).rejects.toThrow(
      "Invalid context token",
    )
  })
})

describe("ensureTargetChatExists", () => {
  test("upserts chat by telegram rhid", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    prisma.chat.upsert.mockResolvedValue({ id: 1 } as never)

    await ensureTargetChatExists(testCrypto, prisma, "-555")

    expect(prisma.chat.upsert.spy()).toHaveBeenCalledTimes(1)
    expect(prisma.chat.upsert.spy()).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          telegramRhid: rhid("-555"),
        },
        update: {
          dataEcid: expect.any(String),
        },
        create: {
          telegramRhid: rhid("-555"),
          dataEcid: expect.any(String),
        },
      }),
    )
  })
})
