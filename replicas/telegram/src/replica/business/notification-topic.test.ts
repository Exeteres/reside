import type { PrismaClient } from "../../database"
import type { TelegramBotLike } from "./notification-types"
import { describe, expect, test } from "bun:test"
import { mockDeepFn, testCrypto } from "@reside/common/testing"
import {
  closeNotificationTopicForReplica,
  reopenNotificationTopicForReplica,
} from "./notification-topic"

type CloseTopicBotLike = {
  api: {
    closeForumTopic: (chatId: string, messageThreadId: number) => Promise<true>
  }
}

type ReopenTopicBotLike = {
  api: {
    reopenForumTopic: (chatId: string, messageThreadId: number) => Promise<true>
  }
}

describe("closeNotificationTopicForReplica", () => {
  test("closes telegram forum topic without deleting stored topic", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const bot = mockDeepFn<CloseTopicBotLike>()

    prisma.notificationTopic.findUnique.mockResolvedValue({
      id: 5,
      threadEcid: await testCrypto.encrypt({
        chat_id: "-1001",
        message_thread_id: 99,
      }),
      creatorSubjectId: "replica:engineer",
    } as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)
    bot.api.closeForumTopic.mockResolvedValue(true as never)

    await closeNotificationTopicForReplica(
      testCrypto,
      prisma,
      () => bot as unknown as TelegramBotLike,
      async () => ({
        botToken: "token",
        systemChatId: "-1001",
      }),
      {
        topicId: "5",
      },
    )

    expect(bot.api.closeForumTopic.spy()).toHaveBeenCalledWith("-1001", 99)
    expect(prisma.notificationTopic.delete.spy()).not.toHaveBeenCalled()
  })
})

describe("reopenNotificationTopicForReplica", () => {
  test("reopens telegram forum topic without changing stored topic", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const bot = mockDeepFn<ReopenTopicBotLike>()

    prisma.notificationTopic.findUnique.mockResolvedValue({
      id: 5,
      threadEcid: await testCrypto.encrypt({
        chat_id: "-1001",
        message_thread_id: 99,
      }),
      creatorSubjectId: "replica:engineer",
    } as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)
    bot.api.reopenForumTopic.mockResolvedValue(true as never)

    await reopenNotificationTopicForReplica(
      testCrypto,
      prisma,
      () => bot as unknown as TelegramBotLike,
      async () => ({
        botToken: "token",
        systemChatId: "-1001",
      }),
      {
        topicId: "5",
      },
    )

    expect(bot.api.reopenForumTopic.spy()).toHaveBeenCalledWith("-1001", 99)
    expect(prisma.notificationTopic.update.spy()).not.toHaveBeenCalled()
    expect(prisma.notificationTopic.delete.spy()).not.toHaveBeenCalled()
  })
})
