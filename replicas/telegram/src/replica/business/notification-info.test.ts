import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { rhid } from "@reside/common"
import { mockDeepFn } from "@reside/common/testing"
import { renderRepliedNotificationInfo, resolveRepliedNotificationInfo } from "./notification-info"

process.env.REPLICA_NAME = "telegram"

describe("resolveRepliedNotificationInfo", () => {
  test("returns channel and sender information for replied notification", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const subjectService = mockDeepFn<{
      getSubjectDisplayInfo(args: { subjectId: string }): Promise<{ title: string }>
    }>()

    prisma.notification.findFirst.mockResolvedValue({
      sendAsSubjectId: "replica:sender",
      callingSubjectId: "replica:caller",
      channel: {
        name: "alerts",
        title: "Alerts",
        description: "Important messages",
      },
    } as never)
    subjectService.getSubjectDisplayInfo.mockResolvedValue({ title: "Sender" } as never)

    const info = await resolveRepliedNotificationInfo(prisma, subjectService, -1001, 42)

    expect(prisma.notification.findFirst.spy()).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          messageRhid: rhid(42),
          chat: {
            telegramRhid: rhid("-1001"),
          },
        },
      }),
    )
    expect(subjectService.getSubjectDisplayInfo.spy()).toHaveBeenCalledWith({
      subjectId: "replica:sender",
    })
    expect(info).toEqual({
      channel: {
        name: "alerts",
        title: "Alerts",
        description: "Important messages",
      },
      sender: {
        subjectId: "replica:sender",
        title: "Sender",
      },
    })
  })

  test("returns null when replied message is not a notification", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const subjectService = mockDeepFn<{
      getSubjectDisplayInfo(args: { subjectId: string }): Promise<{ title: string }>
    }>()

    prisma.notification.findFirst.mockResolvedValue(null as never)

    const info = await resolveRepliedNotificationInfo(prisma, subjectService, -1001, 42)

    expect(info).toBeNull()
    expect(subjectService.getSubjectDisplayInfo.spy()).toHaveBeenCalledTimes(0)
  })

  test("falls back to calling subject when send-as subject is missing", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const subjectService = mockDeepFn<{
      getSubjectDisplayInfo(args: { subjectId: string }): Promise<{ title: string }>
    }>()

    prisma.notification.findFirst.mockResolvedValue({
      sendAsSubjectId: null,
      callingSubjectId: "replica:caller",
      channel: {
        name: "alerts",
        title: "Alerts",
        description: null,
      },
    } as never)
    subjectService.getSubjectDisplayInfo.mockResolvedValue({ title: "Caller" } as never)

    const info = await resolveRepliedNotificationInfo(prisma, subjectService, -1001, 42)

    expect(info?.sender).toEqual({
      subjectId: "replica:caller",
      title: "Caller",
    })
  })
})

describe("renderRepliedNotificationInfo", () => {
  test("renders escaped notification info message", () => {
    const text = renderRepliedNotificationInfo({
      channel: {
        name: "a&b",
        title: "<Alerts>",
        description: "Use > now",
      },
      sender: {
        subjectId: "replica:sender",
        title: "Sender <one>",
      },
    })

    expect(text).toContain("&lt;Alerts&gt;")
    expect(text).toContain("a&amp;b")
    expect(text).toContain("Sender &lt;one&gt;")
    expect(text).not.toContain("<Alerts>")
  })
})
