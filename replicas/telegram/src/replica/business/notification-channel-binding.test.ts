import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { rhid } from "@reside/common"
import { mockDeepFn, testCrypto } from "@reside/common/testing"
import {
  bindNotificationChannel,
  deleteNotificationChannelBinding,
  resolveNotificationChannelRoute,
} from "./notification-channel-binding"

process.env.REPLICA_NAME = "telegram"

describe("bindNotificationChannel", () => {
  test("creates binding for chat without topic", async () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.notificationChannel.findUnique.mockResolvedValue({ id: 11, title: "Alerts" } as never)
    prisma.notificationChannelBinding.upsert.mockResolvedValue({ id: 7 } as never)

    const result = await bindNotificationChannel(testCrypto, prisma, {
      channelName: "alerts",
      chatId: 3,
    })

    expect(result).toEqual({
      bindingId: 7,
      channelTitle: "Alerts",
      topicTitle: undefined,
    })
    expect(prisma.notificationChannelBinding.upsert.spy()).toHaveBeenCalledWith({
      where: {
        channelId: 11,
      },
      create: {
        channelId: 11,
        chatId: 3,
        topicId: null,
      },
      update: {
        chatId: 3,
        topicId: null,
      },
      select: {
        id: true,
      },
    })
  })

  test("creates missing binding topic from current message thread", async () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.notificationChannel.findUnique.mockResolvedValue({ id: 11, title: "Alerts" } as never)
    prisma.notificationTopic.findUnique.mockResolvedValue(null as never)
    prisma.notificationTopic.create.mockResolvedValue({ id: 5, title: "Updates" } as never)
    prisma.notificationChannelBinding.upsert.mockResolvedValue({ id: 7 } as never)

    const result = await bindNotificationChannel(testCrypto, prisma, {
      channelName: "alerts",
      chatId: 3,
      topic: {
        chatId: "-1001",
        messageThreadId: 99,
        title: "Updates",
      },
    })

    expect(result).toEqual({
      bindingId: 7,
      channelTitle: "Alerts",
      topicTitle: "Updates",
    })
    expect(prisma.notificationTopic.findUnique.spy()).toHaveBeenCalledWith({
      where: {
        chatId_threadRhid: {
          chatId: 3,
          threadRhid: rhid(99),
        },
      },
      select: {
        id: true,
        chatId: true,
        channelId: true,
        title: true,
      },
    })
    expect(prisma.notificationTopic.create.spy()).toHaveBeenCalledWith({
      data: {
        chatId: 3,
        channelId: 11,
        threadRhid: rhid(99),
        threadEcid: expect.any(String),
        creatorSubjectId: "replica:telegram",
        title: "Updates",
      },
      select: {
        id: true,
        title: true,
      },
    })
    expect(prisma.notificationChannelBinding.upsert.spy()).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          topicId: 5,
        }),
        update: expect.objectContaining({
          topicId: 5,
        }),
      }),
    )
  })

  test("uses fallback title for created binding topic without telegram title", async () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.notificationChannel.findUnique.mockResolvedValue({ id: 11, title: "Alerts" } as never)
    prisma.notificationTopic.findUnique.mockResolvedValue(null as never)
    prisma.notificationTopic.create.mockResolvedValue({ id: 5, title: "Тема 99" } as never)
    prisma.notificationChannelBinding.upsert.mockResolvedValue({ id: 7 } as never)

    await bindNotificationChannel(testCrypto, prisma, {
      channelName: "alerts",
      chatId: 3,
      topic: {
        chatId: "-1001",
        messageThreadId: 99,
      },
    })

    expect(prisma.notificationTopic.create.spy()).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Тема 99",
        }),
      }),
    )
  })
})

describe("deleteNotificationChannelBinding", () => {
  test("deletes binding for channel", async () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.notificationChannel.findUnique.mockResolvedValue({ id: 11, title: "Alerts" } as never)
    prisma.notificationChannelBinding.deleteMany.mockResolvedValue({ count: 1 } as never)

    const result = await deleteNotificationChannelBinding(prisma, "alerts")

    expect(result).toEqual({ deleted: true, channelTitle: "Alerts" })
    expect(prisma.notificationChannelBinding.deleteMany.spy()).toHaveBeenCalledWith({
      where: {
        channelId: 11,
      },
    })
  })
})

describe("resolveNotificationChannelRoute", () => {
  test("falls back to system chat when channel has no binding", async () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.notificationChannelBinding.findUnique.mockResolvedValue(null as never)

    const result = await resolveNotificationChannelRoute(testCrypto, prisma, {
      channelId: 11,
      channelName: "alerts",
      systemChatId: "-1001",
    })

    expect(result).toEqual({
      chatId: "-1001",
      messageThreadId: undefined,
      topicId: undefined,
    })
  })

  test("resolves chat binding", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const dataEcid = await testCrypto.encrypt({ id: "-1002" })

    prisma.notificationChannelBinding.findUnique.mockResolvedValue({
      topicId: null,
      chat: {
        dataEcid,
      },
      topic: null,
    } as never)

    const result = await resolveNotificationChannelRoute(testCrypto, prisma, {
      channelId: 11,
      channelName: "alerts",
      systemChatId: "-1001",
    })

    expect(result).toEqual({
      chatId: "-1002",
      messageThreadId: undefined,
      topicId: undefined,
    })
  })

  test("resolves topic binding and rejects explicit topic", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const threadEcid = await testCrypto.encrypt({ chat_id: "-1002", message_thread_id: 99 })

    prisma.notificationChannelBinding.findUnique.mockResolvedValue({
      topicId: 5,
      chat: {
        dataEcid: await testCrypto.encrypt({ id: "-1002" }),
      },
      topic: {
        id: 5,
        threadEcid,
      },
    } as never)

    const result = await resolveNotificationChannelRoute(testCrypto, prisma, {
      channelId: 11,
      channelName: "alerts",
      systemChatId: "-1001",
    })

    expect(result).toEqual({
      chatId: "-1002",
      messageThreadId: 99,
      topicId: 5,
    })
    expect(
      resolveNotificationChannelRoute(testCrypto, prisma, {
        channelId: 11,
        channelName: "alerts",
        requestedTopicId: "6",
        systemChatId: "-1001",
      }),
    ).rejects.toThrow('Channel "alerts" is already routed to topic "5"')
  })
})
