import type { GenericOperationService } from "@reside/common"
import type { Operation, PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { rhid } from "@reside/common"
import { mockDeepFn, testCrypto } from "@reside/common/testing"
import {
  completeOperationFromCallbackAction,
  completeOperationFromDiceMessage,
  completeOperationFromTextReply,
} from "./response"

describe("completeOperationFromTextReply", () => {
  test("returns completed=false when no pending operation matches", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findMany.mockResolvedValue([] as never)

    const result = await completeOperationFromTextReply({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      repliedMessageId: 100,
      responseMessageId: 101,
      textResponse: "ok",
      canInteractWithChannel: async () => true,
      isSuperAdminUser: () => false,
    })

    expect(result).toEqual({
      completed: false,
      unauthorized: false,
    })
    expect(operationService.setCompleted.spy()).toHaveBeenCalledTimes(0)
  })

  test("returns unauthorized=true for protected operation without channel permission", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findMany.mockResolvedValue([
      {
        id: 1,
        actionRows: [],
        isProtected: true,
        channel: {
          name: "alerts",
        },
        chat: {
          telegramRhid: rhid("1"),
        },
        operation: {
          id: 77,
          notificationResponse: null,
        },
      },
    ] as never)

    const result = await completeOperationFromTextReply({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      repliedMessageId: 100,
      responseMessageId: 101,
      textResponse: "ok",
      canInteractWithChannel: async () => false,
      isSuperAdminUser: () => false,
    })

    expect(result).toEqual({
      completed: false,
      unauthorized: true,
      unauthorizedChannelName: "alerts",
    })
    expect(prisma.notificationResponse.create.spy()).toHaveBeenCalledTimes(0)
    expect(operationService.setCompleted.spy()).toHaveBeenCalledTimes(0)
  })

  test("persists text response and completes operation", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findMany.mockResolvedValue([
      {
        id: 1,
        actionRows: [],
        isProtected: false,
        channel: {
          name: "alerts",
        },
        chat: {
          telegramRhid: rhid("1"),
        },
        operation: {
          id: 77,
          notificationResponse: null,
        },
      },
    ] as never)
    prisma.notificationResponse.create.mockResolvedValue({} as never)
    prisma.operation.findUnique.mockResolvedValue({
      notificationResponseContextToken: null,
    } as never)
    prisma.operation.update.mockResolvedValue({ id: 77 } as never)

    const result = await completeOperationFromTextReply({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      repliedMessageId: 100,
      responseMessageId: 101,
      textResponse: "approved",
      canInteractWithChannel: async () => true,
      isSuperAdminUser: () => false,
    })

    expect(result).toEqual({
      completed: true,
      unauthorized: false,
    })
    expect(prisma.operation.update.spy()).toHaveBeenCalledTimes(1)
    expect(operationService.setCompleted.spy()).toHaveBeenCalledWith(77)
  })

  test("returns completed=true on duplicate text response when existing pending response is found", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findMany.mockResolvedValue([
      {
        id: 1,
        actionRows: [],
        isProtected: false,
        channel: {
          name: "alerts",
        },
        chat: {
          telegramRhid: rhid("1"),
        },
        operation: {
          id: 77,
          notificationResponse: null,
        },
      },
    ] as never)
    prisma.notificationResponse.create.mockRejectedValue({ code: "P2002" } as never)
    prisma.operation.findUnique.mockResolvedValue({
      status: "PENDING",
      notificationResponse: { operationId: 77 },
    } as never)

    const result = await completeOperationFromTextReply({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      repliedMessageId: 100,
      responseMessageId: 101,
      textResponse: "approved",
      canInteractWithChannel: async () => true,
      isSuperAdminUser: () => false,
    })

    expect(result).toEqual({
      completed: true,
      unauthorized: false,
    })
    expect(operationService.setCompleted.spy()).toHaveBeenCalledWith(77)
  })

  test("returns completed=false on duplicate text response when no existing response is found", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findMany.mockResolvedValue([
      {
        id: 1,
        actionRows: [],
        isProtected: false,
        channel: {
          name: "alerts",
        },
        chat: {
          telegramRhid: rhid("1"),
        },
        operation: {
          id: 77,
          notificationResponse: null,
        },
      },
    ] as never)
    prisma.notificationResponse.create.mockRejectedValue({ code: "P2002" } as never)
    prisma.operation.findUnique.mockResolvedValue({
      status: "COMPLETED",
      notificationResponse: null,
    } as never)

    const result = await completeOperationFromTextReply({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      repliedMessageId: 100,
      responseMessageId: 101,
      textResponse: "approved",
      canInteractWithChannel: async () => true,
      isSuperAdminUser: () => false,
    })

    expect(result).toEqual({
      completed: false,
      unauthorized: false,
    })
    expect(operationService.setCompleted.spy()).toHaveBeenCalledTimes(0)
  })
})

describe("completeOperationFromDiceMessage", () => {
  test("returns completed=false when no pending dice operation matches", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findFirst.mockResolvedValue(null as never)

    const result = await completeOperationFromDiceMessage({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      subjectUserId: 20,
      messageThreadId: undefined,
      responseMessageId: 101,
      emoji: "🎲",
      value: 4,
      canInteractWithChannel: async () => true,
      isSuperAdminUser: () => false,
    })

    expect(result).toEqual({
      completed: false,
      unauthorized: false,
    })
    expect(operationService.setCompleted.spy()).toHaveBeenCalledTimes(0)
  })

  test("queries accepted dice emoji in the chat without requiring a reply", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findFirst.mockResolvedValue(null as never)

    await completeOperationFromDiceMessage({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      subjectUserId: 20,
      messageThreadId: undefined,
      responseMessageId: 101,
      emoji: "🎲",
      value: 4,
      canInteractWithChannel: async () => true,
      isSuperAdminUser: () => false,
    })

    expect(prisma.notification.findFirst.spy()).toHaveBeenCalledWith({
      where: {
        acceptedDiceEmojis: {
          has: "🎲",
        },
        protectedForSubjectId: "telegram:20",
        chat: {
          telegramRhid: rhid("1"),
        },
        topicId: null,
        operation: {
          status: "PENDING",
          notificationResponse: null,
        },
      },
      select: {
        operation: {
          select: {
            id: true,
          },
        },
      },
      orderBy: {
        id: "desc",
      },
    })
  })

  test("scopes dice lookup to message thread when present", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findFirst.mockResolvedValue(null as never)

    await completeOperationFromDiceMessage({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      subjectUserId: 20,
      messageThreadId: 55,
      responseMessageId: 101,
      emoji: "🎲",
      value: 4,
      canInteractWithChannel: async () => true,
      isSuperAdminUser: () => false,
    })

    expect(prisma.notification.findFirst.spy()).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          topic: {
            threadRhid: rhid(55),
          },
        }),
      }),
    )
  })

  test("ignores dice operation when responder is not the protected subject", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findFirst.mockResolvedValue(null as never)

    const result = await completeOperationFromDiceMessage({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      subjectUserId: 21,
      messageThreadId: undefined,
      responseMessageId: 101,
      emoji: "🎲",
      value: 4,
      canInteractWithChannel: async () => true,
      isSuperAdminUser: () => false,
    })

    expect(result).toEqual({
      completed: false,
      unauthorized: false,
    })
    expect(prisma.notificationResponse.create.spy()).toHaveBeenCalledTimes(0)
    expect(operationService.setCompleted.spy()).toHaveBeenCalledTimes(0)
    expect(prisma.notification.findFirst.spy()).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          protectedForSubjectId: "telegram:21",
        }),
      }),
    )
  })

  test("ignores dice operation when responder subject is unknown", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    const result = await completeOperationFromDiceMessage({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      messageThreadId: undefined,
      responseMessageId: 101,
      emoji: "🎲",
      value: 4,
      canInteractWithChannel: async () => true,
      isSuperAdminUser: () => false,
    })

    expect(result).toEqual({
      completed: false,
      unauthorized: false,
    })
    expect(prisma.notificationResponse.create.spy()).toHaveBeenCalledTimes(0)
    expect(prisma.notification.findFirst.spy()).toHaveBeenCalledTimes(0)
    expect(operationService.setCompleted.spy()).toHaveBeenCalledTimes(0)
  })

  test("accepts dice operation protected for responder subject", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findFirst.mockResolvedValue({
      protectedForSubjectId: "telegram:20",
      operation: {
        id: 77,
      },
    } as never)
    prisma.notificationResponse.create.mockResolvedValue({} as never)
    prisma.operation.update.mockResolvedValue({ id: 77 } as never)

    const result = await completeOperationFromDiceMessage({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      subjectUserId: 20,
      messageThreadId: undefined,
      responseMessageId: 101,
      emoji: "🎲",
      value: 4,
      canInteractWithChannel: async () => true,
      isSuperAdminUser: () => false,
    })

    expect(result).toEqual({
      completed: true,
      unauthorized: false,
    })
    expect(operationService.setCompleted.spy()).toHaveBeenCalledWith(77)
  })

  test("persists dice response and completes operation", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findFirst.mockResolvedValue({
      protectedForSubjectId: "telegram:20",
      operation: {
        id: 77,
      },
    } as never)
    prisma.notificationResponse.create.mockResolvedValue({} as never)
    prisma.operation.update.mockResolvedValue({ id: 77 } as never)

    const result = await completeOperationFromDiceMessage({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      subjectUserId: 20,
      messageThreadId: undefined,
      responseMessageId: 101,
      emoji: "🎲",
      value: 4,
      canInteractWithChannel: async () => true,
      isSuperAdminUser: () => false,
    })

    expect(result).toEqual({
      completed: true,
      unauthorized: false,
    })
    expect(prisma.notificationResponse.create.spy()).toHaveBeenCalledWith({
      data: {
        operationId: 77,
        type: "DICE",
        actionName: null,
        subjectId: "telegram:20",
        textResponseEcid: null,
        diceEmoji: "🎲",
        diceValue: 4,
      },
    })
    expect(prisma.operation.update.spy()).toHaveBeenCalledTimes(1)
    expect(operationService.setCompleted.spy()).toHaveBeenCalledWith(77)
  })

  test("returns completed=true on duplicate dice response for pending operation", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findFirst.mockResolvedValue({
      protectedForSubjectId: "telegram:20",
      operation: {
        id: 77,
      },
    } as never)
    prisma.notificationResponse.create.mockRejectedValue({ code: "P2002" } as never)
    prisma.operation.findUnique.mockResolvedValue({
      status: "PENDING",
      notificationResponse: { operationId: 77 },
    } as never)

    const result = await completeOperationFromDiceMessage({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      subjectUserId: 20,
      messageThreadId: undefined,
      responseMessageId: 101,
      emoji: "🎲",
      value: 4,
      canInteractWithChannel: async () => true,
      isSuperAdminUser: () => false,
    })

    expect(result).toEqual({
      completed: true,
      unauthorized: false,
    })
    expect(operationService.setCompleted.spy()).toHaveBeenCalledWith(77)
  })
})

describe("completeOperationFromCallbackAction", () => {
  test("returns action-not-allowed when callback action is not listed", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findMany.mockResolvedValue([
      {
        id: 1,
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
        isProtected: false,
        channel: {
          name: "alerts",
        },
        chat: {
          telegramRhid: rhid("1"),
        },
        operation: {
          id: 77,
          notificationResponse: null,
        },
      },
    ] as never)

    const result = await completeOperationFromCallbackAction({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      messageId: 100,
      actionName: "reject",
      canInteractWithChannel: async () => true,
      isSuperAdminUser: () => false,
    })

    expect(result).toEqual({
      accepted: false,
      unauthorized: false,
      reason: "action-not-allowed",
    })
    expect(prisma.notificationResponse.create.spy()).toHaveBeenCalledTimes(0)
  })

  test("returns not-found when operation does not exist", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findMany.mockResolvedValue([] as never)
    prisma.notification.findFirst.mockResolvedValue(null as never)

    const result = await completeOperationFromCallbackAction({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      messageId: 100,
      actionName: "approve",
      canInteractWithChannel: async () => true,
      isSuperAdminUser: () => false,
    })

    expect(result).toEqual({
      accepted: false,
      unauthorized: false,
      reason: "not-found",
    })
  })

  test("returns chat-not-authorized when pending operations exist but chat does not match", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findMany.mockResolvedValue([
      {
        id: 1,
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
        isProtected: false,
        channel: {
          name: "alerts",
        },
        chat: {
          telegramRhid: rhid("2"),
        },
        operation: {
          id: 77,
          notificationResponse: null,
        },
      },
    ] as never)

    const result = await completeOperationFromCallbackAction({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      messageId: 100,
      actionName: "approve",
      canInteractWithChannel: async () => true,
      isSuperAdminUser: () => false,
    })

    expect(result).toEqual({
      accepted: false,
      unauthorized: false,
      reason: "chat-not-authorized",
    })
  })

  test("returns already-responded when authorized operation already has response", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findMany.mockResolvedValue([
      {
        id: 1,
        actionRows: [],
        isProtected: false,
        channel: {
          name: "alerts",
        },
        chat: {
          telegramRhid: rhid("1"),
        },
        operation: {
          id: 77,
          notificationResponse: { operationId: 77 },
        },
      },
    ] as never)

    const result = await completeOperationFromCallbackAction({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      messageId: 100,
      actionName: "approve",
      canInteractWithChannel: async () => true,
      isSuperAdminUser: () => false,
    })

    expect(result).toEqual({
      accepted: false,
      unauthorized: false,
      reason: "already-responded",
    })
  })

  test("returns unauthorized for protected actionable operation", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findMany.mockResolvedValue([
      {
        id: 1,
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
        isProtected: true,
        channel: {
          name: "alerts",
        },
        chat: {
          telegramRhid: rhid("1"),
        },
        operation: {
          id: 77,
          notificationResponse: null,
        },
      },
    ] as never)

    const result = await completeOperationFromCallbackAction({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      messageId: 100,
      actionName: "approve",
      canInteractWithChannel: async () => false,
      isSuperAdminUser: () => false,
    })

    expect(result).toEqual({
      accepted: false,
      unauthorized: true,
      reason: "chat-not-authorized",
      unauthorizedChannelName: "alerts",
    })
  })

  test("accepts duplicate callback response when existing pending response is found", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findMany.mockResolvedValue([
      {
        id: 1,
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
        isProtected: false,
        channel: {
          name: "alerts",
        },
        chat: {
          telegramRhid: rhid("1"),
        },
        operation: {
          id: 77,
          notificationResponse: null,
        },
      },
    ] as never)
    prisma.notificationResponse.create.mockRejectedValue({ code: "P2002" } as never)
    prisma.operation.findUnique.mockResolvedValue({
      status: "PENDING",
      notificationResponse: { operationId: 77 },
    } as never)

    const result = await completeOperationFromCallbackAction({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      messageId: 100,
      actionName: "approve",
      canInteractWithChannel: async () => true,
      isSuperAdminUser: () => false,
    })

    expect(result).toEqual({
      accepted: true,
      unauthorized: false,
      reason: "accepted",
    })
    expect(operationService.setCompleted.spy()).toHaveBeenCalledWith(77)
  })

  test("returns already-responded on duplicate callback response without pending response", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findMany.mockResolvedValue([
      {
        id: 1,
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
        isProtected: false,
        channel: {
          name: "alerts",
        },
        chat: {
          telegramRhid: rhid("1"),
        },
        operation: {
          id: 77,
          notificationResponse: null,
        },
      },
    ] as never)
    prisma.notificationResponse.create.mockRejectedValue({ code: "P2002" } as never)
    prisma.operation.findUnique.mockResolvedValue({
      status: "FAILED",
      notificationResponse: null,
    } as never)

    const result = await completeOperationFromCallbackAction({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      messageId: 100,
      actionName: "approve",
      canInteractWithChannel: async () => true,
      isSuperAdminUser: () => false,
    })

    expect(result).toEqual({
      accepted: false,
      unauthorized: false,
      reason: "already-responded",
    })
  })

  test("persists callback response and completes operation", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findMany.mockResolvedValue([
      {
        id: 1,
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
        isProtected: false,
        channel: {
          name: "alerts",
        },
        chat: {
          telegramRhid: rhid("1"),
        },
        operation: {
          id: 77,
          notificationResponse: null,
        },
      },
    ] as never)
    prisma.notificationResponse.create.mockResolvedValue({} as never)
    operationService.setCompleted.mockResolvedValue(undefined as never)

    const result = await completeOperationFromCallbackAction({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      messageId: 100,
      actionName: "approve",
      canInteractWithChannel: async () => true,
      isSuperAdminUser: () => false,
    })

    expect(result).toEqual({
      accepted: true,
      unauthorized: false,
      reason: "accepted",
    })
    expect(prisma.notificationResponse.create.spy()).toHaveBeenCalledTimes(1)
    expect(operationService.setCompleted.spy()).toHaveBeenCalledWith(77)
  })

  test("returns unauthorized for callback protected for another subject", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<Operation>>()

    prisma.notification.findMany.mockResolvedValue([
      {
        id: 1,
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
        isProtected: false,
        protectedForSubjectId: "telegram:20",
        channel: {
          name: "alerts",
        },
        chat: {
          telegramRhid: rhid("1"),
        },
        operation: {
          id: 77,
          notificationResponse: null,
        },
      },
    ] as never)

    const result = await completeOperationFromCallbackAction({
      crypto: testCrypto,
      prisma,
      operationService,
      chatId: 1,
      userId: 10,
      subjectUserId: 21,
      messageId: 100,
      actionName: "approve",
      canInteractWithChannel: async () => true,
      isSuperAdminUser: () => false,
    })

    expect(result).toEqual({
      accepted: false,
      unauthorized: true,
      reason: "chat-not-authorized",
      unauthorizedChannelName: "alerts",
    })
    expect(prisma.notificationResponse.create.spy()).toHaveBeenCalledTimes(0)
  })
})
