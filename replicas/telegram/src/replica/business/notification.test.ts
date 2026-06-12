import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { mockDeepFn, testCrypto } from "@reside/common/testing"
import { createInteractionContextToken } from "../../shared"
import {
  assertActionRows,
  deleteNotificationForReplica,
  parseNotificationId,
  sendNotificationForReplica,
  updateNotificationForReplica,
} from "./notification"

type TransactionPrisma = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$extends" | "$on" | "$transaction"
>

type TelegramBotLike = {
  api: {
    sendMessage: (
      chatId: string,
      text: string,
      options?: Record<string, unknown>,
    ) => Promise<{ message_id: number }>
    editMessageText: (
      chatId: string,
      messageId: number,
      text: string,
      options?: Record<string, unknown>,
    ) => Promise<unknown>
    deleteMessage: (chatId: string, messageId: number) => Promise<true>
    sendPhoto: (...args: unknown[]) => Promise<{ message_id: number }>
    sendDocument: (...args: unknown[]) => Promise<{ message_id: number }>
    sendMediaGroup: (...args: unknown[]) => Promise<{ message_id: number }[]>
  }
}

process.env.REPLICA_NAME = "telegram"

async function encryptTelegramMessage(messageId: number, chatId = "-1001"): Promise<string> {
  return await testCrypto.encrypt({
    message_id: messageId,
    chat: {
      id: chatId,
    },
  })
}

describe("parseNotificationId", () => {
  test("throws for invalid id", () => {
    expect(() => parseNotificationId("abc")).toThrow('Invalid notification id "abc"')
  })
})

describe("assertActionRows", () => {
  test("throws when action name is empty", () => {
    expect(() => {
      assertActionRows([
        {
          actions: [
            {
              name: "",
            },
          ],
        },
      ])
    }).toThrow("Action name must not be empty")
  })
})

describe("sendNotificationForReplica", () => {
  test("throws when target channel does not exist", () => {
    const prisma = mockDeepFn<PrismaClient>()
    const authzService = mockDeepFn<{
      checkPermission: (args: {
        permissionName: string
        subjectId: string
        scope: string
      }) => Promise<{ authorized: boolean }>
    }>()
    const subjectService = mockDeepFn<{
      getSubjectDisplayInfo: (args: { subjectId: string }) => Promise<{ title: string }>
    }>()
    const bot = mockDeepFn<TelegramBotLike>()

    subjectService.getSubjectDisplayInfo.mockResolvedValue({ title: "Sender" } as never)
    prisma.notificationChannel.findUnique.mockResolvedValue(null as never)

    expect(
      sendNotificationForReplica(
        testCrypto,
        prisma,
        authzService,
        subjectService,
        () => bot,
        async () => ({
          botToken: "token",
          systemChatId: "-1001",
        }),
        "demo",
        {
          channel: "alerts",
          title: "Title",
          content: "Body",
          actionRows: [],
          images: [],
          attachments: [],
          requiresTextResponse: false,
        },
      ),
    ).rejects.toThrow('Channel with name "alerts" was not found')
  })

  test("sends notification and creates record without operation", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const authzService = mockDeepFn<{
      checkPermission: (args: {
        permissionName: string
        subjectId: string
        scope: string
      }) => Promise<{ authorized: boolean }>
    }>()
    const subjectService = mockDeepFn<{
      getSubjectDisplayInfo: (args: { subjectId: string }) => Promise<{ title: string }>
    }>()
    const bot = mockDeepFn<TelegramBotLike>()

    prisma.notificationChannel.findUnique.mockResolvedValue({ id: 11 } as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)
    prisma.chat.upsert.mockResolvedValue({ id: 1 } as never)
    prisma.notification.create.mockResolvedValue({ id: 77 } as never)
    subjectService.getSubjectDisplayInfo.mockResolvedValue({ title: "Sender" } as never)
    bot.api.sendMessage.mockResolvedValue({ message_id: 123 } as never)

    const result = await sendNotificationForReplica(
      testCrypto,
      prisma,
      authzService,
      subjectService,
      () => bot,
      async () => ({
        botToken: "token",
        systemChatId: "-1001",
      }),
      "demo",
      {
        channel: "alerts",
        title: "Title",
        content: "Body",
        actionRows: [],
        images: [],
        attachments: [],
        requiresTextResponse: false,
      },
    )

    expect(result).toEqual({
      messageLink: expect.stringMatching(/^enc:test:/),
      notificationId: "77",
      operationId: undefined,
    })
    expect(bot.api.sendMessage.spy()).toHaveBeenCalledTimes(1)
    expect(prisma.notification.create.spy()).toHaveBeenCalledTimes(1)
    expect(prisma.operation.create.spy()).toHaveBeenCalledTimes(0)
  })

  test("replies to command message in same-chat command context", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const authzService = mockDeepFn<{
      checkPermission: (args: {
        permissionName: string
        subjectId: string
        scope: string
      }) => Promise<{ authorized: boolean }>
    }>()
    const subjectService = mockDeepFn<{
      getSubjectDisplayInfo: (args: { subjectId: string }) => Promise<{ title: string }>
    }>()
    const bot = mockDeepFn<TelegramBotLike>()
    const contextToken = await createInteractionContextToken(testCrypto, {
      chat_id: "-1001",
      message_id: 42,
    })

    prisma.notificationChannel.findUnique.mockResolvedValue({ id: 11, name: "alerts" } as never)
    prisma.notificationChannelBinding.findUnique.mockResolvedValue(null as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)
    prisma.chat.upsert.mockResolvedValue({ id: 1 } as never)
    prisma.notification.create.mockResolvedValue({ id: 77 } as never)
    subjectService.getSubjectDisplayInfo.mockResolvedValue({ title: "Sender" } as never)
    bot.api.sendMessage.mockResolvedValue({ message_id: 123 } as never)

    await sendNotificationForReplica(
      testCrypto,
      prisma,
      authzService,
      subjectService,
      () => bot,
      async () => ({
        botToken: "token",
        systemChatId: "-1001",
      }),
      "demo",
      {
        channel: "alerts",
        title: "Title",
        content: "Body",
        actionRows: [],
        images: [],
        attachments: [],
        contextToken,
        requiresTextResponse: false,
      },
    )

    expect(bot.api.sendMessage.spy()).toHaveBeenCalledWith(
      "-1001",
      expect.any(String),
      expect.objectContaining({
        reply_parameters: {
          message_id: 42,
        },
        message_thread_id: undefined,
      }),
    )
  })

  test("creates wait operation when notification requires response", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const authzService = mockDeepFn<{
      checkPermission: (args: {
        permissionName: string
        subjectId: string
        scope: string
      }) => Promise<{ authorized: boolean }>
    }>()
    const subjectService = mockDeepFn<{
      getSubjectDisplayInfo: (args: { subjectId: string }) => Promise<{ title: string }>
    }>()
    const bot = mockDeepFn<TelegramBotLike>()

    subjectService.getSubjectDisplayInfo.mockResolvedValue({ title: "Sender" } as never)
    prisma.notificationChannel.findUnique.mockResolvedValue({ id: 11 } as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)
    prisma.chat.upsert.mockResolvedValue({ id: 1 } as never)
    bot.api.sendMessage.mockResolvedValue({ message_id: 123 } as never)
    prisma.operation.create.mockResolvedValue({ id: 55 } as never)
    prisma.notification.create.mockResolvedValue({ id: 77 } as never)

    prisma.$transaction.mockImplementation(
      async (callback: (tx: TransactionPrisma) => Promise<unknown>) => {
        return await callback(prisma as unknown as TransactionPrisma)
      },
    )

    const result = await sendNotificationForReplica(
      testCrypto,
      prisma,
      authzService,
      subjectService,
      () => bot,
      async () => ({
        botToken: "token",
        systemChatId: "-1001",
      }),
      "demo",
      {
        channel: "alerts",
        title: "Title",
        content: "Body",
        actionRows: [
          {
            actions: [
              {
                name: "approve",
                title: "Approve",
              },
            ],
          },
        ],
        images: [],
        attachments: [],
        requiresTextResponse: false,
      },
    )

    expect(result).toEqual({
      messageLink: expect.stringMatching(/^enc:test:/),
      notificationId: "77",
      operationId: 55,
    })
    expect(prisma.operation.create.spy()).toHaveBeenCalledTimes(1)
  })

  test("does not prepend sender header for telegram replica without avatar", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const authzService = mockDeepFn<{
      checkPermission: (args: {
        permissionName: string
        subjectId: string
        scope: string
      }) => Promise<{ authorized: boolean }>
    }>()
    const subjectService = mockDeepFn<{
      getSubjectDisplayInfo: (args: { subjectId: string }) => Promise<{ title: string }>
    }>()
    const bot = mockDeepFn<TelegramBotLike>()

    prisma.notificationChannel.findUnique.mockResolvedValue({ id: 11 } as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)
    prisma.chat.upsert.mockResolvedValue({ id: 1 } as never)
    prisma.notification.create.mockResolvedValue({ id: 77 } as never)
    subjectService.getSubjectDisplayInfo.mockResolvedValue({ title: "Sender" } as never)
    bot.api.sendMessage.mockResolvedValue({ message_id: 123 } as never)

    await sendNotificationForReplica(
      testCrypto,
      prisma,
      authzService,
      subjectService,
      () => bot,
      async () => ({
        botToken: "token",
        systemChatId: "-1001",
      }),
      "telegram",
      {
        channel: "alerts",
        title: "Title",
        content: "Body",
        actionRows: [],
        images: [],
        attachments: [],
        requiresTextResponse: false,
      },
    )

    const sendText = bot.api.sendMessage.spy().mock.calls[0]?.[1]
    expect(sendText).toContain("Title")
    expect(sendText).toContain("Body")
    expect(sendText).not.toContain("Sender")
  })
})

describe("updateNotificationForReplica", () => {
  test("throws when title is empty", () => {
    const prisma = mockDeepFn<PrismaClient>()
    const subjectService = mockDeepFn<{
      getSubjectDisplayInfo: (args: { subjectId: string }) => Promise<{ title: string }>
    }>()
    const bot = mockDeepFn<TelegramBotLike>()

    subjectService.getSubjectDisplayInfo.mockResolvedValue({ title: "Sender" } as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)

    expect(
      updateNotificationForReplica(
        testCrypto,
        prisma,
        subjectService,
        () => bot,
        async () => ({
          botToken: "token",
          systemChatId: "-1001",
        }),
        "demo",
        {
          notificationId: "7",
          title: "",
          content: "New content",
          actionRows: [],
          requiresTextResponse: false,
        },
      ),
    ).rejects.toThrow("Notification title must not be empty")
  })

  test("throws when notification does not exist", () => {
    const prisma = mockDeepFn<PrismaClient>()
    const subjectService = mockDeepFn<{
      getSubjectDisplayInfo: (args: { subjectId: string }) => Promise<{ title: string }>
    }>()
    const bot = mockDeepFn<TelegramBotLike>()

    subjectService.getSubjectDisplayInfo.mockResolvedValue({ title: "Sender" } as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)
    prisma.notification.findFirst.mockResolvedValue(null as never)

    expect(
      updateNotificationForReplica(
        testCrypto,
        prisma,
        subjectService,
        () => bot,
        async () => ({
          botToken: "token",
          systemChatId: "-1001",
        }),
        "demo",
        {
          notificationId: "7",
          title: "New title",
          content: "New content",
          actionRows: [],
          requiresTextResponse: false,
        },
      ),
    ).rejects.toThrow('Notification "7" was not found')
  })

  test("updates existing notification without creating operation", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const subjectService = mockDeepFn<{
      getSubjectDisplayInfo: (args: { subjectId: string }) => Promise<{ title: string }>
    }>()
    const bot = mockDeepFn<TelegramBotLike>()

    subjectService.getSubjectDisplayInfo.mockResolvedValue({ title: "Sender" } as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)
    prisma.notification.findFirst.mockResolvedValue({
      id: 7,
      title: "Old title",
      content: "Old content",
      messageEcid: await encryptTelegramMessage(900),
      actionRows: [],
      requiresTextResponse: false,
      operationId: null,
      operation: null,
    } as never)
    bot.api.editMessageText.mockResolvedValue({} as never)
    prisma.notification.update.mockResolvedValue({ id: 7 } as never)

    prisma.$transaction.mockImplementation(
      async (callback: (tx: TransactionPrisma) => Promise<unknown>) => {
        return await callback(prisma as unknown as TransactionPrisma)
      },
    )

    const result = await updateNotificationForReplica(
      testCrypto,
      prisma,
      subjectService,
      () => bot,
      async () => ({
        botToken: "token",
        systemChatId: "-1001",
      }),
      "demo",
      {
        notificationId: "7",
        title: "New title",
        content: "New content",
        actionRows: [],
        requiresTextResponse: false,
      },
    )

    expect(result.operationId).toBeUndefined()
    expect(bot.api.editMessageText.spy()).toHaveBeenCalledTimes(1)
    expect(prisma.operation.create.spy()).toHaveBeenCalledTimes(0)
    expect(prisma.notification.update.spy()).toHaveBeenCalledTimes(1)
  })

  test("creates operation when update introduces pending response", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const subjectService = mockDeepFn<{
      getSubjectDisplayInfo: (args: { subjectId: string }) => Promise<{ title: string }>
    }>()
    const bot = mockDeepFn<TelegramBotLike>()

    subjectService.getSubjectDisplayInfo.mockResolvedValue({ title: "Sender" } as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)
    prisma.notification.findFirst.mockResolvedValue({
      id: 7,
      title: "Old title",
      content: "Old content",
      messageEcid: await encryptTelegramMessage(900),
      actionRows: [],
      requiresTextResponse: false,
      operationId: null,
      operation: null,
    } as never)
    bot.api.editMessageText.mockResolvedValue({} as never)
    prisma.operation.create.mockResolvedValue({ id: 88 } as never)
    prisma.notification.update.mockResolvedValue({ id: 7 } as never)

    prisma.$transaction.mockImplementation(
      async (callback: (tx: TransactionPrisma) => Promise<unknown>) => {
        return await callback(prisma as unknown as TransactionPrisma)
      },
    )

    const result = await updateNotificationForReplica(
      testCrypto,
      prisma,
      subjectService,
      () => bot,
      async () => ({
        botToken: "token",
        systemChatId: "-1001",
      }),
      "demo",
      {
        notificationId: "7",
        title: "New title",
        content: "New content",
        actionRows: [
          {
            actions: [
              {
                name: "approve",
                title: "Approve",
              },
            ],
          },
        ],
        requiresTextResponse: false,
      },
    )

    expect(result).toEqual({ operationId: 88 })
    expect(prisma.operation.create.spy()).toHaveBeenCalledTimes(1)
  })

  test("replaces existing pending operation when requirements change", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const subjectService = mockDeepFn<{
      getSubjectDisplayInfo: (args: { subjectId: string }) => Promise<{ title: string }>
    }>()
    const bot = mockDeepFn<TelegramBotLike>()

    subjectService.getSubjectDisplayInfo.mockResolvedValue({ title: "Sender" } as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)
    prisma.notification.findFirst.mockResolvedValue({
      id: 7,
      title: "Old title",
      content: "Old content",
      messageEcid: await encryptTelegramMessage(900),
      actionRows: [
        {
          actions: [
            {
              name: "approve",
              title: "Approve",
            },
          ],
        },
      ],
      requiresTextResponse: false,
      operationId: 42,
      operation: { status: "PENDING" },
    } as never)
    bot.api.editMessageText.mockResolvedValue({} as never)
    prisma.operation.update.mockResolvedValue({ id: 42 } as never)
    prisma.operation.create.mockResolvedValue({ id: 99 } as never)
    prisma.notification.update.mockResolvedValue({ id: 7 } as never)

    prisma.$transaction.mockImplementation(
      async (callback: (tx: TransactionPrisma) => Promise<unknown>) => {
        return await callback(prisma as unknown as TransactionPrisma)
      },
    )

    const result = await updateNotificationForReplica(
      testCrypto,
      prisma,
      subjectService,
      () => bot,
      async () => ({
        botToken: "token",
        systemChatId: "-1001",
      }),
      "demo",
      {
        notificationId: "7",
        title: "New title",
        content: "New content",
        actionRows: [],
        requiresTextResponse: true,
      },
    )

    expect(result).toEqual({ operationId: 99 })
    expect(prisma.operation.update.spy()).toHaveBeenCalledTimes(1)
    expect(prisma.operation.create.spy()).toHaveBeenCalledTimes(1)
  })

  test("does not prepend sender header on update for telegram replica without avatar", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const subjectService = mockDeepFn<{
      getSubjectDisplayInfo: (args: { subjectId: string }) => Promise<{ title: string }>
    }>()
    const bot = mockDeepFn<TelegramBotLike>()

    subjectService.getSubjectDisplayInfo.mockResolvedValue({ title: "Sender" } as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)
    prisma.notification.findFirst.mockResolvedValue({
      id: 7,
      title: "Old title",
      content: "Old content",
      messageEcid: await encryptTelegramMessage(900),
      actionRows: [],
      requiresTextResponse: false,
      operationId: null,
      operation: null,
    } as never)
    bot.api.editMessageText.mockResolvedValue({} as never)
    prisma.notification.update.mockResolvedValue({ id: 7 } as never)

    prisma.$transaction.mockImplementation(
      async (callback: (tx: TransactionPrisma) => Promise<unknown>) => {
        return await callback(prisma as unknown as TransactionPrisma)
      },
    )

    await updateNotificationForReplica(
      testCrypto,
      prisma,
      subjectService,
      () => bot,
      async () => ({
        botToken: "token",
        systemChatId: "-1001",
      }),
      "telegram",
      {
        notificationId: "7",
        title: "New title",
        content: "New content",
        actionRows: [],
        requiresTextResponse: false,
      },
    )

    const editedText = bot.api.editMessageText.spy().mock.calls[0]?.[2]
    expect(editedText).toContain("New title")
    expect(editedText).toContain("New content")
    expect(editedText).not.toContain("Sender")
  })
})

describe("deleteNotificationForReplica", () => {
  test("throws when notification does not exist", () => {
    const prisma = mockDeepFn<PrismaClient>()
    const bot = mockDeepFn<TelegramBotLike>()

    prisma.notification.findFirst.mockResolvedValue(null as never)

    expect(
      deleteNotificationForReplica(
        testCrypto,
        prisma,
        () => bot,
        async () => ({
          botToken: "token",
          systemChatId: "-1001",
        }),
        {
          notificationId: "7",
        },
      ),
    ).rejects.toThrow('Notification "7" was not found')
  })

  test("deletes telegram message and notification with pending operation cleanup", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const bot = mockDeepFn<TelegramBotLike>()

    prisma.notification.findFirst.mockResolvedValue({
      id: 7,
      messageEcid: await encryptTelegramMessage(900),
      sendAsSubjectId: "replica:demo",
      operationId: 42,
      operation: {
        status: "PENDING",
      },
    } as never)
    prisma.avatar.findUnique.mockResolvedValue({
      tokenEcid: await testCrypto.encrypt("avatar-token"),
    } as never)
    bot.api.deleteMessage.mockResolvedValue(true as never)
    prisma.operation.update.mockResolvedValue({ id: 42 } as never)
    prisma.notification.delete.mockResolvedValue({ id: 7 } as never)

    prisma.$transaction.mockImplementation(
      async (callback: (tx: TransactionPrisma) => Promise<unknown>) => {
        return await callback(prisma as unknown as TransactionPrisma)
      },
    )

    await deleteNotificationForReplica(
      testCrypto,
      prisma,
      () => bot,
      async () => ({
        botToken: "token",
        systemChatId: "-1001",
      }),
      {
        notificationId: "7",
      },
    )

    expect(bot.api.deleteMessage.spy()).toHaveBeenCalledTimes(1)
    expect(bot.api.deleteMessage.spy()).toHaveBeenCalledWith("-1001", 900)
    expect(prisma.operation.update.spy()).toHaveBeenCalledTimes(1)
    expect(prisma.notification.delete.spy()).toHaveBeenCalledTimes(1)
  })

  test("deletes notification without operation update when operation is not pending", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const bot = mockDeepFn<TelegramBotLike>()

    prisma.notification.findFirst.mockResolvedValue({
      id: 7,
      messageEcid: await encryptTelegramMessage(900),
      sendAsSubjectId: null,
      operationId: 42,
      operation: {
        status: "COMPLETED",
      },
    } as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)
    bot.api.deleteMessage.mockResolvedValue(true as never)
    prisma.notification.delete.mockResolvedValue({ id: 7 } as never)

    prisma.$transaction.mockImplementation(
      async (callback: (tx: TransactionPrisma) => Promise<unknown>) => {
        return await callback(prisma as unknown as TransactionPrisma)
      },
    )

    await deleteNotificationForReplica(
      testCrypto,
      prisma,
      () => bot,
      async () => ({
        botToken: "token",
        systemChatId: "-1001",
      }),
      {
        notificationId: "7",
      },
    )

    expect(prisma.operation.update.spy()).toHaveBeenCalledTimes(0)
    expect(prisma.notification.delete.spy()).toHaveBeenCalledTimes(1)
  })
})
