import type { GenericOperationService } from "@reside/common"
import type { Operation, PrismaClient } from "../../database"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rhid } from "@reside/common"
import { mockDeepFn, testCrypto } from "@reside/common/testing"
import { TELEGRAM_INTERACTION_CONTEXT_ENV_NAME } from "../../shared"
import { completeOperationFromCallbackAction, completeOperationFromTextReply } from "./response"

const originalContextKey = process.env[TELEGRAM_INTERACTION_CONTEXT_ENV_NAME]

beforeEach(() => {
  process.env[TELEGRAM_INTERACTION_CONTEXT_ENV_NAME] = Buffer.alloc(32, 1).toString("base64url")
})

afterEach(() => {
  process.env[TELEGRAM_INTERACTION_CONTEXT_ENV_NAME] = originalContextKey
})

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
    prisma.operation.findUnique.mockResolvedValue({ customData: { existing: true } } as never)
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
})
