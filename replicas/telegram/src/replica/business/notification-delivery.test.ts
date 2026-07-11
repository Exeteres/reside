import type { PrismaClient } from "../../database"
import type { TelegramBotLike } from "./notification-types"
import { describe, expect, mock, test } from "bun:test"
import { mockDeepFn, mockFn, testCrypto } from "@reside/common/testing"
import {
  sendAvatarPrivacyModeWarning,
  sendNotificationPayload,
  sendNotificationWithReplyFallback,
} from "./notification-delivery"

describe("sendNotificationPayload", () => {
  test("sends plain message when no media is provided", async () => {
    const bot = mockDeepFn<TelegramBotLike>()
    bot.api.sendMessage.mockResolvedValue({ message_id: 10 } as never)

    const sentMessageId = await sendNotificationPayload(
      bot,
      "-1001",
      {
        images: [],
        attachments: [],
      },
      "Message",
      undefined,
      undefined,
    )

    expect(sentMessageId.message_id).toBe(10)
    expect(bot.api.sendMessage.spy()).toHaveBeenCalledTimes(1)
  })

  test("sends attachment document for single attachment", async () => {
    const bot = mockDeepFn<TelegramBotLike>()
    bot.api.sendMessage.mockResolvedValue({ message_id: 10 } as never)
    bot.api.sendDocument.mockResolvedValue({ message_id: 20 } as never)

    const sentMessageId = await sendNotificationPayload(
      bot,
      "-1001",
      {
        images: [],
        attachments: [
          {
            content: new Uint8Array([1, 2, 3]),
            name: "report.txt",
          },
        ],
      },
      "Message",
      undefined,
      undefined,
    )

    expect(sentMessageId.message_id).toBe(10)
    expect(bot.api.sendDocument.spy()).toHaveBeenCalledTimes(1)
  })

  test("sends sticker after plain message", async () => {
    const sendSticker = mock(async () => ({ message_id: 11 }))
    const bot: TelegramBotLike = {
      api: {
        sendMessage: mock(async () => ({ message_id: 10 })),
        editMessageText: mock(async () => undefined),
        deleteMessage: mock(async () => true as const),
        setMessageReaction: mock(async () => true as const),
        sendPhoto: mock(async () => ({ message_id: 20 })),
        sendDocument: mock(async () => ({ message_id: 30 })),
        sendMediaGroup: mock(async () => [{ message_id: 40 }]),
        sendSticker,
      },
    }

    const sentMessageId = await sendNotificationPayload(
      bot,
      "-1001",
      {
        images: [],
        attachments: [],
        stickerFileId: "sticker-1",
      },
      "Message",
      undefined,
      44,
    )

    expect(sentMessageId.message_id).toBe(10)
    expect(sendSticker).toHaveBeenCalledWith("-1001", "sticker-1", {
      reply_parameters: {
        message_id: 10,
      },
      message_thread_id: undefined,
    })
  })

  test("uses image message id when image is sent without reply markup", async () => {
    const bot = mockDeepFn<TelegramBotLike>()
    bot.api.sendPhoto.mockResolvedValue({ message_id: 101 } as never)

    const sentMessageId = await sendNotificationPayload(
      bot,
      "-1001",
      {
        images: [
          {
            content: new Uint8Array([1]),
            name: "pic.png",
          },
        ],
        attachments: [],
      },
      "Message",
      undefined,
      undefined,
    )

    expect(sentMessageId.message_id).toBe(101)
    expect(bot.api.sendPhoto.spy()).toHaveBeenCalledTimes(1)
    expect(bot.api.sendMessage.spy()).toHaveBeenCalledTimes(0)
  })

  test("sends action prompt when media exists and reply markup is provided", async () => {
    const bot = mockDeepFn<TelegramBotLike>()
    bot.api.sendMediaGroup.mockResolvedValue([{ message_id: 201 }] as never)
    bot.api.sendMessage.mockResolvedValue({ message_id: 301 } as never)

    const sentMessageId = await sendNotificationPayload(
      bot,
      "-1001",
      {
        images: [
          {
            content: new Uint8Array([1]),
            name: "one.png",
          },
          {
            content: new Uint8Array([2]),
            name: "two.png",
          },
        ],
        attachments: [],
      },
      "Message",
      {
        inline_keyboard: [[{ callback_data: "approve", text: "Approve" }]],
      },
      44,
    )

    expect(sentMessageId.message_id).toBe(301)
    expect(bot.api.sendMediaGroup.spy()).toHaveBeenCalledTimes(1)
    expect(bot.api.sendMessage.spy()).toHaveBeenCalledTimes(1)
  })

  test("throws when media group returns no first image message", async () => {
    const bot = mockDeepFn<TelegramBotLike>()
    bot.api.sendMediaGroup.mockResolvedValue([] as never)

    expect(
      sendNotificationPayload(
        bot,
        "-1001",
        {
          images: [
            {
              content: new Uint8Array([1]),
              name: "one.png",
            },
            {
              content: new Uint8Array([2]),
              name: "two.png",
            },
          ],
          attachments: [],
        },
        "Message",
        undefined,
        undefined,
      ),
    ).rejects.toThrow("Failed to send image group")
  })
})

describe("sendNotificationWithReplyFallback", () => {
  test("retries without reply target when replied message is missing", async () => {
    const bot = mockDeepFn<TelegramBotLike>()
    bot.api.sendMessage
      .mockRejectedValueOnce(new Error("message to be replied not found"))
      .mockResolvedValueOnce({ message_id: 321 } as never)

    const result = await sendNotificationWithReplyFallback(
      bot,
      "-1001",
      "replica:demo",
      {
        images: [],
        attachments: [],
      },
      "Message",
      undefined,
      555,
    )

    expect(result).toEqual({
      sentMessage: {
        message_id: 321,
      },
      sentMessageId: 321,
      usedReplyFallback: true,
    })
    expect(bot.api.sendMessage.spy()).toHaveBeenCalledTimes(2)
  })

  test("returns direct result when fallback is not needed", async () => {
    const bot = mockDeepFn<TelegramBotLike>()
    bot.api.sendMessage.mockResolvedValue({ message_id: 111 } as never)

    const result = await sendNotificationWithReplyFallback(
      bot,
      "-1001",
      "replica:demo",
      {
        images: [],
        attachments: [],
      },
      "Message",
      undefined,
      undefined,
    )

    expect(result).toEqual({
      sentMessage: {
        message_id: 111,
      },
      sentMessageId: 111,
      usedReplyFallback: false,
    })
  })

  test("rethrows unknown errors without fallback", async () => {
    const bot = mockDeepFn<TelegramBotLike>()
    bot.api.sendMessage.mockRejectedValue(new Error("network down"))

    expect(
      sendNotificationWithReplyFallback(
        bot,
        "-1001",
        "replica:demo",
        {
          images: [],
          attachments: [],
        },
        "Message",
        undefined,
        555,
      ),
    ).rejects.toThrow("network down")
  })
})

describe("sendAvatarPrivacyModeWarning", () => {
  test("skips warning when warning channel is absent", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const createTelegramBotClient = mockFn()

    prisma.notificationChannel.findUnique.mockResolvedValue(null as never)

    await sendAvatarPrivacyModeWarning(
      testCrypto,
      prisma,
      createTelegramBotClient as unknown as (
        token: string,
        args: { role: string },
      ) => TelegramBotLike,
      "manager-token",
      "-1001",
      "replica:telegram",
      "replica:demo",
    )

    expect(createTelegramBotClient.spy()).toHaveBeenCalledTimes(0)
    expect(prisma.notification.create.spy()).toHaveBeenCalledTimes(0)
  })

  test("sends warning and persists notification when warning channel exists", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const warningBot = mockDeepFn<TelegramBotLike>()
    const createTelegramBotClient = mockFn()

    prisma.notificationChannel.findUnique.mockResolvedValue({ id: 42 } as never)
    prisma.avatar.findUnique.mockResolvedValue({ managedBotUsername: "demo_bot" } as never)
    prisma.chat.upsert.mockResolvedValue({ id: 9 } as never)
    warningBot.api.sendMessage.mockResolvedValue({ message_id: 808 } as never)
    createTelegramBotClient.spy().mockReturnValue(warningBot as never)

    await sendAvatarPrivacyModeWarning(
      testCrypto,
      prisma,
      createTelegramBotClient as unknown as (
        token: string,
        args: { role: string },
      ) => TelegramBotLike,
      "manager-token",
      "-1001",
      "replica:telegram",
      "replica:demo",
    )

    expect(createTelegramBotClient.spy()).toHaveBeenCalledTimes(1)
    expect(warningBot.api.sendMessage.spy()).toHaveBeenCalledTimes(1)
    expect(prisma.notification.create.spy()).toHaveBeenCalledTimes(1)
  })

  test("uses fallback bot username placeholder when managed username is missing", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const warningBot = mockDeepFn<TelegramBotLike>()
    const createTelegramBotClient = mockFn()

    prisma.notificationChannel.findUnique.mockResolvedValue({ id: 42 } as never)
    prisma.avatar.findUnique.mockResolvedValue({ managedBotUsername: "   " } as never)
    prisma.chat.upsert.mockResolvedValue({ id: 9 } as never)
    warningBot.api.sendMessage.mockResolvedValue({ message_id: 808 } as never)
    createTelegramBotClient.spy().mockReturnValue(warningBot as never)

    await sendAvatarPrivacyModeWarning(
      testCrypto,
      prisma,
      createTelegramBotClient as unknown as (
        token: string,
        args: { role: string },
      ) => TelegramBotLike,
      "manager-token",
      "-1001",
      "replica:telegram",
      "replica:demo",
    )

    expect(prisma.notification.create.spy()).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining("bot_username"),
        }),
      }),
    )
  })
})
