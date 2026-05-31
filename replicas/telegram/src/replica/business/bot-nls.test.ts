import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type { PermissionRequestServiceClient } from "@reside/api/access/request.v1"
import type { DiscoveryServiceClient } from "@reside/api/alpha/discovery.v1"
import type { NaturalLanguageServiceClient } from "@reside/api/interaction/nls.v1"
import type { PrismaClient } from "../../database"
import { describe, expect, mock, test } from "bun:test"
import { mockDeepFn } from "@reside/common/testing"
import { strings } from "../../locale"
import { handleNlsMessage } from "./bot-nls"

type TelegramBotLike = {
  api: {
    sendMessage: (...args: unknown[]) => Promise<unknown>
    setMessageReaction: (...args: unknown[]) => Promise<unknown>
  }
}

describe("handleNlsMessage", () => {
  test("returns early when continuation interaction is missing", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const discoveryService = mockDeepFn<DiscoveryServiceClient>()
    const authzService = mockDeepFn<AuthzServiceClient>()
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    const nlsClient = mockDeepFn<NaturalLanguageServiceClient>()
    const telegramBot = mockDeepFn<TelegramBotLike>()

    prisma.naturalLanguageInteraction.findUnique.mockResolvedValue(null as never)

    await handleNlsMessage({
      prisma,
      discoveryService,
      authzService,
      permissionRequestService,
      getNaturalLanguageClient: () => nlsClient,
      createTelegramBotClient: (() => telegramBot) as never,
      managerToken: "manager-token",
      chatId: 10,
      userId: 20,
      message: {
        message_id: 30,
      },
      text: "hello",
      mentionedUsername: undefined,
    })

    expect(authzService.checkPermission.spy()).toHaveBeenCalledTimes(0)
    expect(discoveryService.getSubjectEndpoint.spy()).toHaveBeenCalledTimes(0)
    expect(prisma.naturalLanguageInteraction.findUnique.spy()).toHaveBeenCalledWith({
      where: {
        chatId_threadId: {
          chatId: "10",
          threadId: 30,
        },
      },
      select: {
        replicaName: true,
        user: {
          select: {
            telegramId: true,
          },
        },
      },
    })
  })

  test("uses reply thread id for continuation lookup", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const discoveryService = mockDeepFn<DiscoveryServiceClient>()
    const authzService = mockDeepFn<AuthzServiceClient>()
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    const nlsClient = mockDeepFn<NaturalLanguageServiceClient>()
    const telegramBot = mockDeepFn<TelegramBotLike>()

    prisma.naturalLanguageInteraction.findUnique.mockResolvedValue(null as never)

    await handleNlsMessage({
      prisma,
      discoveryService,
      authzService,
      permissionRequestService,
      getNaturalLanguageClient: () => nlsClient,
      createTelegramBotClient: (() => telegramBot) as never,
      managerToken: "manager-token",
      chatId: 10,
      userId: 20,
      message: {
        message_id: 30,
        reply_to_message: {
          message_thread_id: 99,
        },
      },
      text: "hello",
      mentionedUsername: undefined,
    })

    expect(prisma.naturalLanguageInteraction.findUnique.spy()).toHaveBeenCalledWith({
      where: {
        chatId_threadId: {
          chatId: "10",
          threadId: 99,
        },
      },
      select: {
        replicaName: true,
        user: {
          select: {
            telegramId: true,
          },
        },
      },
    })
  })

  test("returns early when mentioned avatar is not found", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const discoveryService = mockDeepFn<DiscoveryServiceClient>()
    const authzService = mockDeepFn<AuthzServiceClient>()
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    const nlsClient = mockDeepFn<NaturalLanguageServiceClient>()
    const telegramBot = mockDeepFn<TelegramBotLike>()

    prisma.avatar.findFirst.mockResolvedValue(null as never)

    await handleNlsMessage({
      prisma,
      discoveryService,
      authzService,
      permissionRequestService,
      getNaturalLanguageClient: () => nlsClient,
      createTelegramBotClient: (() => telegramBot) as never,
      managerToken: "manager-token",
      chatId: 10,
      userId: 20,
      message: {
        message_id: 30,
      },
      text: "hello",
      mentionedUsername: "unknown_bot",
    })

    expect(prisma.naturalLanguageInteraction.upsert.spy()).toHaveBeenCalledTimes(0)
    expect(authzService.checkPermission.spy()).toHaveBeenCalledTimes(0)
    expect(discoveryService.getSubjectEndpoint.spy()).toHaveBeenCalledTimes(0)
    expect(prisma.avatar.findFirst.spy()).toHaveBeenCalledWith({
      where: {
        managedBotUsername: {
          equals: "unknown_bot",
          mode: "insensitive",
        },
      },
      select: {
        replicaName: true,
      },
    })
  })

  test("creates interaction with owner user when mention is resolved", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const discoveryService = mockDeepFn<DiscoveryServiceClient>()
    const authzService = mockDeepFn<AuthzServiceClient>()
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    const nlsClient = mockDeepFn<NaturalLanguageServiceClient>()
    const telegramBot = mockDeepFn<TelegramBotLike>()

    prisma.avatar.findFirst.mockResolvedValue({
      replicaName: "alpha",
    } as never)
    prisma.user.findUnique.mockResolvedValue({
      id: 55,
      telegramId: "20",
    } as never)
    prisma.naturalLanguageInteraction.upsert.mockResolvedValue({ id: 1 } as never)
    authzService.checkPermission.mockResolvedValue({ authorized: false } as never)
    permissionRequestService.requestPermissions.mockResolvedValue({} as never)

    await handleNlsMessage({
      prisma,
      discoveryService,
      authzService,
      permissionRequestService,
      getNaturalLanguageClient: () => nlsClient,
      createTelegramBotClient: (() => telegramBot) as never,
      managerToken: "manager-token",
      chatId: 10,
      userId: 20,
      message: {
        message_id: 30,
      },
      text: "hello",
      mentionedUsername: "alpha_bot",
    })

    expect(prisma.naturalLanguageInteraction.upsert.spy()).toHaveBeenCalledWith({
      where: {
        chatId_threadId: {
          chatId: "10",
          threadId: 30,
        },
      },
      create: {
        chatId: "10",
        userId: 55,
        threadId: 30,
        replicaName: "alpha",
      },
      update: {
        userId: 55,
        replicaName: "alpha",
      },
      select: {
        id: true,
      },
    })
  })

  test("returns ownership hint when continuation belongs to another user", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const discoveryService = mockDeepFn<DiscoveryServiceClient>()
    const authzService = mockDeepFn<AuthzServiceClient>()
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    const nlsClient = mockDeepFn<NaturalLanguageServiceClient>()
    const telegramBot = mockDeepFn<TelegramBotLike>()

    telegramBot.api.sendMessage.mockResolvedValue({} as never)
    prisma.naturalLanguageInteraction.findUnique.mockResolvedValue({
      replicaName: "alpha",
      user: {
        telegramId: "777",
      },
    } as never)

    await handleNlsMessage({
      prisma,
      discoveryService,
      authzService,
      permissionRequestService,
      getNaturalLanguageClient: () => nlsClient,
      createTelegramBotClient: (() => telegramBot) as never,
      managerToken: "manager-token",
      chatId: 10,
      userId: 20,
      message: {
        message_id: 30,
      },
      text: "hello",
      mentionedUsername: undefined,
    })

    expect(authzService.checkPermission.spy()).toHaveBeenCalledTimes(0)
    expect(discoveryService.getSubjectEndpoint.spy()).toHaveBeenCalledTimes(0)
    expect(telegramBot.api.sendMessage.spy()).toHaveBeenCalledTimes(1)
    expect(telegramBot.api.sendMessage.spy()).toHaveBeenCalledWith(
      10,
      strings.worker.bot.nlsSessionOwnedByAnotherUser("alpha"),
      expect.anything(),
    )
  })

  test("returns early when mentioned avatar exists but owner user is missing", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const discoveryService = mockDeepFn<DiscoveryServiceClient>()
    const authzService = mockDeepFn<AuthzServiceClient>()
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    const nlsClient = mockDeepFn<NaturalLanguageServiceClient>()
    const telegramBot = mockDeepFn<TelegramBotLike>()

    prisma.avatar.findFirst.mockResolvedValue({
      replicaName: "alpha",
    } as never)
    prisma.user.findUnique.mockResolvedValue(null as never)

    await handleNlsMessage({
      prisma,
      discoveryService,
      authzService,
      permissionRequestService,
      getNaturalLanguageClient: () => nlsClient,
      createTelegramBotClient: (() => telegramBot) as never,
      managerToken: "manager-token",
      chatId: 10,
      userId: 20,
      message: {
        message_id: 30,
      },
      text: "hello",
      mentionedUsername: "alpha_bot",
    })

    expect(prisma.naturalLanguageInteraction.upsert.spy()).toHaveBeenCalledTimes(0)
    expect(authzService.checkPermission.spy()).toHaveBeenCalledTimes(0)
    expect(telegramBot.api.sendMessage.spy()).toHaveBeenCalledTimes(0)
  })

  test("handles authorized continuation with reaction and reply", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const discoveryService = mockDeepFn<DiscoveryServiceClient>()
    const authzService = mockDeepFn<AuthzServiceClient>()
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    const nlsClient = mockDeepFn<NaturalLanguageServiceClient>()
    const telegramBot = mockDeepFn<TelegramBotLike>()
    const createTelegramBotClient = mock((_token: string, _args: { role?: string }) => telegramBot)

    prisma.naturalLanguageInteraction.findUnique.mockResolvedValue({
      replicaName: "alpha",
      user: {
        telegramId: "20",
      },
    } as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)
    authzService.checkPermission.mockResolvedValue({ authorized: true } as never)
    discoveryService.getSubjectEndpoint.mockResolvedValue({ endpoint: "http://alpha" } as never)
    nlsClient.ask.mockResolvedValue({ text: "ok" } as never)
    telegramBot.api.setMessageReaction.mockResolvedValue({} as never)
    telegramBot.api.sendMessage.mockResolvedValue({} as never)

    await handleNlsMessage({
      prisma,
      discoveryService,
      authzService,
      permissionRequestService,
      getNaturalLanguageClient: () => nlsClient,
      createTelegramBotClient: createTelegramBotClient as never,
      managerToken: "manager-token",
      chatId: 10,
      userId: 20,
      message: {
        message_id: 30,
      },
      text: "hello",
      mentionedUsername: undefined,
    })

    expect(permissionRequestService.requestPermissions.spy()).toHaveBeenCalledTimes(0)
    expect(discoveryService.getSubjectEndpoint.spy()).toHaveBeenCalledWith({
      subjectId: "replica:alpha",
    })
    expect(nlsClient.ask.spy()).toHaveBeenCalledWith({
      text: "hello",
      subjectId: "telegram:20",
    })
    expect(telegramBot.api.setMessageReaction.spy()).toHaveBeenCalledTimes(1)
    expect(telegramBot.api.sendMessage.spy()).toHaveBeenCalledWith(10, "ok", expect.anything())
    expect(createTelegramBotClient).toHaveBeenCalledTimes(2)
  })
})
