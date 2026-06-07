import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type { PermissionRequestServiceClient } from "@reside/api/access/request.v1"
import type { DiscoveryServiceClient } from "@reside/api/alpha/discovery.v1"
import type { NaturalLanguageServiceClient } from "@reside/api/interaction/nls.v1"
import type { PrismaClient } from "../../database"
import { describe, expect, mock, test } from "bun:test"
import { rhid } from "@reside/common"
import { mockDeepFn, testCrypto } from "@reside/common/testing"
import { strings } from "../../locale"
import { handleNlsMessage } from "./bot-nls"

type TelegramBotLike = {
  api: {
    sendMessage: (...args: unknown[]) => Promise<{ message_id: number }>
    sendMessageDraft: (...args: unknown[]) => Promise<unknown>
    sendChatAction: (...args: unknown[]) => Promise<unknown>
    editMessageText: (...args: unknown[]) => Promise<unknown>
  }
}

process.env.REPLICA_NAME = "telegram"

type MockPrismaClient = ReturnType<typeof mockDeepFn<PrismaClient>>

function mockTelegramChat(prisma: MockPrismaClient): void {
  prisma.chat.findUnique.mockResolvedValue({ id: 10 } as never)
}

describe("handleNlsMessage", () => {
  test("returns early when continuation interaction is missing", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const discoveryService = mockDeepFn<DiscoveryServiceClient>()
    const authzService = mockDeepFn<AuthzServiceClient>()
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    const nlsClient = mockDeepFn<NaturalLanguageServiceClient>()
    const telegramBot = mockDeepFn<TelegramBotLike>()

    mockTelegramChat(prisma)
    prisma.naturalLanguageInteraction.findUnique.mockResolvedValue(null as never)

    await handleNlsMessage({
      prisma,
      discoveryService,
      authzService,
      permissionRequestService,
      crypto: testCrypto,
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
        chatId_threadRhid: {
          chatId: 10,
          threadRhid: rhid(30),
        },
      },
      select: {
        replicaName: true,
        user: {
          select: {
            telegramRhid: true,
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

    mockTelegramChat(prisma)
    prisma.naturalLanguageInteraction.findUnique.mockResolvedValue(null as never)

    await handleNlsMessage({
      prisma,
      discoveryService,
      authzService,
      permissionRequestService,
      crypto: testCrypto,
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
        chatId_threadRhid: {
          chatId: 10,
          threadRhid: rhid(99),
        },
      },
      select: {
        replicaName: true,
        user: {
          select: {
            telegramRhid: true,
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

    mockTelegramChat(prisma)
    prisma.avatar.findFirst.mockResolvedValue(null as never)

    await handleNlsMessage({
      prisma,
      discoveryService,
      authzService,
      permissionRequestService,
      crypto: testCrypto,
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

    mockTelegramChat(prisma)
    prisma.avatar.findFirst.mockResolvedValue({
      replicaName: "alpha",
    } as never)
    prisma.user.findUnique.mockResolvedValue({
      id: 55,
      telegramRhid: rhid("20"),
    } as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)
    prisma.naturalLanguageInteraction.upsert.mockResolvedValue({ id: 1 } as never)
    authzService.checkPermission.mockResolvedValue({ authorized: false } as never)
    permissionRequestService.requestPermissions.mockResolvedValue({} as never)

    await handleNlsMessage({
      prisma,
      discoveryService,
      authzService,
      permissionRequestService,
      crypto: testCrypto,
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
        chatId_threadRhid: {
          chatId: 10,
          threadRhid: rhid(30),
        },
      },
      create: {
        chatId: 10,
        userId: 55,
        threadRhid: rhid(30),
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
    mockTelegramChat(prisma)
    prisma.naturalLanguageInteraction.findUnique.mockResolvedValue({
      replicaName: "alpha",
      user: {
        telegramRhid: rhid("777"),
      },
    } as never)

    await handleNlsMessage({
      prisma,
      discoveryService,
      authzService,
      permissionRequestService,
      crypto: testCrypto,
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

    mockTelegramChat(prisma)
    prisma.avatar.findFirst.mockResolvedValue({
      replicaName: "alpha",
    } as never)
    prisma.user.findUnique.mockResolvedValue(null as never)

    await handleNlsMessage({
      prisma,
      discoveryService,
      authzService,
      permissionRequestService,
      crypto: testCrypto,
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

  test("handles authorized continuation with draft stream and final reply", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const discoveryService = mockDeepFn<DiscoveryServiceClient>()
    const authzService = mockDeepFn<AuthzServiceClient>()
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    const nlsClient = mockDeepFn<NaturalLanguageServiceClient>()
    const telegramBot = mockDeepFn<TelegramBotLike>()
    const createTelegramBotClient = mock((_token: string, _args: { role?: string }) => telegramBot)

    mockTelegramChat(prisma)
    prisma.naturalLanguageInteraction.findUnique.mockResolvedValue({
      replicaName: "alpha",
      user: {
        telegramRhid: rhid("20"),
      },
    } as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)
    authzService.checkPermission.mockResolvedValue({ authorized: true } as never)
    discoveryService.getSubjectEndpoint.mockResolvedValue({ endpoint: "http://alpha" } as never)
    nlsClient.askStream.mockImplementation(async function* () {
      yield {
        text: "ok",
        reset: true,
      } as never
    })
    telegramBot.api.sendMessageDraft.mockResolvedValue(true as never)
    telegramBot.api.sendMessage.mockResolvedValue({} as never)

    await handleNlsMessage({
      prisma,
      discoveryService,
      authzService,
      permissionRequestService,
      crypto: testCrypto,
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
    expect(nlsClient.askStream.spy()).toHaveBeenCalledWith({
      text: "hello",
      subjectId: "telegram:20",
      subjectInfo: {},
    })
    expect(telegramBot.api.sendMessageDraft.spy()).toHaveBeenCalledTimes(2)
    expect(telegramBot.api.sendMessageDraft.spy()).toHaveBeenNthCalledWith(1, 10, 30, "", {
      parse_mode: "HTML",
    })
    expect(telegramBot.api.sendMessageDraft.spy()).toHaveBeenNthCalledWith(2, 10, 30, "ok", {
      parse_mode: "HTML",
    })
    expect(telegramBot.api.sendMessage.spy()).toHaveBeenCalledWith(10, "ok", expect.anything())
    expect(createTelegramBotClient).toHaveBeenCalledTimes(1)
  })

  test("uses topic thread id for sendMessageDraft only when message is in topic", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const discoveryService = mockDeepFn<DiscoveryServiceClient>()
    const authzService = mockDeepFn<AuthzServiceClient>()
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    const nlsClient = mockDeepFn<NaturalLanguageServiceClient>()
    const telegramBot = mockDeepFn<TelegramBotLike>()

    mockTelegramChat(prisma)
    prisma.naturalLanguageInteraction.findUnique.mockResolvedValue({
      replicaName: "alpha",
      user: {
        telegramRhid: rhid("20"),
      },
    } as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)
    authzService.checkPermission.mockResolvedValue({ authorized: true } as never)
    discoveryService.getSubjectEndpoint.mockResolvedValue({ endpoint: "http://alpha" } as never)
    nlsClient.askStream.mockImplementation(async function* () {
      yield {
        text: "ok",
        reset: true,
      } as never
    })
    telegramBot.api.sendMessageDraft.mockResolvedValue(true as never)
    telegramBot.api.sendMessage.mockResolvedValue({} as never)

    await handleNlsMessage({
      prisma,
      discoveryService,
      authzService,
      permissionRequestService,
      crypto: testCrypto,
      getNaturalLanguageClient: () => nlsClient,
      createTelegramBotClient: (() => telegramBot) as never,
      managerToken: "manager-token",
      chatId: 10,
      userId: 20,
      message: {
        message_id: 30,
        is_topic_message: true,
        message_thread_id: 99,
      },
      text: "hello",
      mentionedUsername: undefined,
    })

    expect(telegramBot.api.sendMessageDraft.spy()).toHaveBeenNthCalledWith(1, 10, 30, "", {
      message_thread_id: 99,
      parse_mode: "HTML",
    })
    expect(telegramBot.api.sendMessageDraft.spy()).toHaveBeenNthCalledWith(2, 10, 30, "ok", {
      message_thread_id: 99,
      parse_mode: "HTML",
    })
    expect(telegramBot.api.sendMessage.spy()).toHaveBeenCalledWith(10, "ok", expect.anything())
  })

  test("uses sendMessage and editMessageText stream in group chat", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const discoveryService = mockDeepFn<DiscoveryServiceClient>()
    const authzService = mockDeepFn<AuthzServiceClient>()
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    const nlsClient = mockDeepFn<NaturalLanguageServiceClient>()
    const telegramBot = mockDeepFn<TelegramBotLike>()

    mockTelegramChat(prisma)
    prisma.naturalLanguageInteraction.findUnique.mockResolvedValue({
      replicaName: "alpha",
      user: {
        telegramRhid: rhid("20"),
      },
    } as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)
    authzService.checkPermission.mockResolvedValue({ authorized: true } as never)
    discoveryService.getSubjectEndpoint.mockResolvedValue({ endpoint: "http://alpha" } as never)
    nlsClient.askStream.mockImplementation(async function* () {
      yield {
        text: "ok",
        reset: true,
      } as never
    })
    telegramBot.api.sendMessage.mockResolvedValue({ message_id: 101 } as never)
    telegramBot.api.sendChatAction.mockResolvedValue(true as never)
    telegramBot.api.editMessageText.mockResolvedValue({} as never)

    await handleNlsMessage({
      prisma,
      discoveryService,
      authzService,
      permissionRequestService,
      crypto: testCrypto,
      getNaturalLanguageClient: () => nlsClient,
      createTelegramBotClient: (() => telegramBot) as never,
      managerToken: "manager-token",
      chatId: -1001,
      userId: 20,
      message: {
        message_id: 30,
      },
      text: "hello",
      mentionedUsername: undefined,
    })

    expect(telegramBot.api.sendMessageDraft.spy()).toHaveBeenCalledTimes(0)
    expect(telegramBot.api.sendMessage.spy()).toHaveBeenCalledTimes(1)
    expect(telegramBot.api.sendMessage.spy()).toHaveBeenCalledWith(-1001, "ok", expect.anything())
    expect(telegramBot.api.editMessageText.spy()).toHaveBeenCalledTimes(0)
    expect(telegramBot.api.sendChatAction.spy()).toHaveBeenCalledTimes(1)
  })

  test("coalesces group stream burst edits to latest state", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const discoveryService = mockDeepFn<DiscoveryServiceClient>()
    const authzService = mockDeepFn<AuthzServiceClient>()
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    const nlsClient = mockDeepFn<NaturalLanguageServiceClient>()
    const telegramBot = mockDeepFn<TelegramBotLike>()

    mockTelegramChat(prisma)
    prisma.naturalLanguageInteraction.findUnique.mockResolvedValue({
      replicaName: "alpha",
      user: {
        telegramRhid: rhid("20"),
      },
    } as never)
    prisma.avatar.findUnique.mockResolvedValue(null as never)
    authzService.checkPermission.mockResolvedValue({ authorized: true } as never)
    discoveryService.getSubjectEndpoint.mockResolvedValue({ endpoint: "http://alpha" } as never)
    nlsClient.askStream.mockImplementation(async function* () {
      yield {
        text: "first",
        reset: true,
      } as never
      yield {
        text: "second",
        reset: false,
      } as never
      yield {
        text: "third",
        reset: false,
      } as never
    })
    telegramBot.api.sendMessage.mockResolvedValue({ message_id: 101 } as never)
    telegramBot.api.sendChatAction.mockResolvedValue(true as never)
    telegramBot.api.editMessageText.mockResolvedValue({} as never)

    await handleNlsMessage({
      prisma,
      discoveryService,
      authzService,
      permissionRequestService,
      crypto: testCrypto,
      getNaturalLanguageClient: () => nlsClient,
      createTelegramBotClient: (() => telegramBot) as never,
      managerToken: "manager-token",
      chatId: -1001,
      userId: 20,
      message: {
        message_id: 30,
      },
      text: "hello",
      mentionedUsername: undefined,
    })

    expect(telegramBot.api.sendMessage.spy()).toHaveBeenCalledWith(
      -1001,
      "first",
      expect.anything(),
    )
    expect(telegramBot.api.editMessageText.spy()).toHaveBeenCalledTimes(1)
    expect(telegramBot.api.editMessageText.spy()).toHaveBeenCalledWith(
      -1001,
      101,
      "third",
      expect.anything(),
    )
  })
})
