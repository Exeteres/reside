import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type { PermissionRequestServiceClient } from "@reside/api/access/request.v1"
import type { CommandHandlerServiceClient } from "@reside/api/interaction/command.v1"
import type { PrismaClient } from "../../database"
import { describe, expect, mock, test } from "bun:test"
import { CommandParameterType } from "@reside/api/interaction/definition.v1"
import { mockDeepFn } from "@reside/common/testing"
import { strings } from "../../locale"
import { handleCommandInvocation } from "./bot-command-invocation"

describe("handleCommandInvocation", () => {
  test("returns early for non-command text", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const authzService = mockDeepFn<AuthzServiceClient>()
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    const commandHandlerClient = mockDeepFn<CommandHandlerServiceClient>()
    const sendSystemMessage = mock(async (_input: { text: string; replyToMessageId: number }) => {})

    await handleCommandInvocation({
      prisma,
      authzService,
      permissionRequestService,
      getCommandHandlerClient: () => commandHandlerClient,
      chatId: 1,
      userId: 2,
      messageId: 3,
      text: "hello",
      interactionContext: {
        token: "token",
        title: "title",
      },
      sendSystemMessage,
    })

    expect(prisma.command.findUnique.spy()).toHaveBeenCalledTimes(0)
    expect(sendSystemMessage).toHaveBeenCalledTimes(0)
  })

  test("sends command-not-found message", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const authzService = mockDeepFn<AuthzServiceClient>()
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    const commandHandlerClient = mockDeepFn<CommandHandlerServiceClient>()
    const sendSystemMessage = mock(async (_input: { text: string; replyToMessageId: number }) => {})

    prisma.command.findUnique.mockResolvedValue(null as never)

    await handleCommandInvocation({
      prisma,
      authzService,
      permissionRequestService,
      getCommandHandlerClient: () => commandHandlerClient,
      chatId: 1,
      userId: 2,
      messageId: 3,
      text: "/missing",
      interactionContext: {
        token: "token",
        title: "title",
      },
      sendSystemMessage,
    })

    expect(sendSystemMessage).toHaveBeenCalledWith({
      text: strings.worker.bot.commandNotFound("missing"),
      replyToMessageId: 3,
    })
  })

  test("auto-requests permission and denies protected command", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const authzService = mockDeepFn<AuthzServiceClient>()
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    const commandHandlerClient = mockDeepFn<CommandHandlerServiceClient>()
    const sendSystemMessage = mock(async (_input: { text: string; replyToMessageId: number }) => {})

    prisma.command.findUnique.mockResolvedValue({
      id: 1,
      name: "deploy",
      title: "Deploy",
      description: null,
      parameters: [],
      isProtected: true,
      callbackEndpoint: "https://handler.local",
    } as never)
    authzService.checkPermission.mockResolvedValue({ authorized: false } as never)
    permissionRequestService.requestPermissions.mockResolvedValue({} as never)

    await handleCommandInvocation({
      prisma,
      authzService,
      permissionRequestService,
      getCommandHandlerClient: () => commandHandlerClient,
      chatId: 1,
      userId: 2,
      messageId: 3,
      text: "/deploy",
      interactionContext: {
        token: "token",
        title: "title",
      },
      sendSystemMessage,
    })

    expect(permissionRequestService.requestPermissions.spy()).toHaveBeenCalledTimes(1)
    expect(sendSystemMessage).toHaveBeenCalledWith({
      text: strings.common.accessDenied,
      replyToMessageId: 3,
    })
  })

  test("denies protected command without auto-request when permission check fails", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const authzService = mockDeepFn<AuthzServiceClient>()
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    const commandHandlerClient = mockDeepFn<CommandHandlerServiceClient>()
    const sendSystemMessage = mock(async (_input: { text: string; replyToMessageId: number }) => {})

    prisma.command.findUnique.mockResolvedValue({
      id: 1,
      name: "deploy",
      title: "Deploy",
      description: null,
      parameters: [],
      isProtected: true,
      callbackEndpoint: "https://handler.local",
    } as never)
    authzService.checkPermission.mockRejectedValue(new Error("boom"))

    await handleCommandInvocation({
      prisma,
      authzService,
      permissionRequestService,
      getCommandHandlerClient: () => commandHandlerClient,
      chatId: 1,
      userId: 2,
      messageId: 3,
      text: "/deploy",
      interactionContext: {
        token: "token",
        title: "title",
      },
      sendSystemMessage,
    })

    expect(permissionRequestService.requestPermissions.spy()).toHaveBeenCalledTimes(0)
    expect(sendSystemMessage).toHaveBeenCalledWith({
      text: strings.common.accessDenied,
      replyToMessageId: 3,
    })
  })

  test("sends parsing error when command params are invalid", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const authzService = mockDeepFn<AuthzServiceClient>()
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    const commandHandlerClient = mockDeepFn<CommandHandlerServiceClient>()
    const sendSystemMessage = mock(async (_input: { text: string; replyToMessageId: number }) => {})

    prisma.command.findUnique.mockResolvedValue({
      id: 1,
      name: "deploy",
      title: "Deploy",
      description: null,
      parameters: [
        {
          name: "count",
          title: "Count",
          type: CommandParameterType.INTEGER,
          required: true,
          rest: false,
        },
      ],
      isProtected: false,
      callbackEndpoint: "https://handler.local",
    } as never)

    await handleCommandInvocation({
      prisma,
      authzService,
      permissionRequestService,
      getCommandHandlerClient: () => commandHandlerClient,
      chatId: 1,
      userId: 2,
      messageId: 3,
      text: "/deploy nope",
      interactionContext: {
        token: "token",
        title: "title",
      },
      sendSystemMessage,
    })

    expect(sendSystemMessage).toHaveBeenCalledWith({
      text: strings.worker.bot.parameterMustBeInteger("count"),
      replyToMessageId: 3,
    })
  })

  test("maps internal failures to broken message", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const authzService = mockDeepFn<AuthzServiceClient>()
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    const commandHandlerClient = mockDeepFn<CommandHandlerServiceClient>()
    const sendSystemMessage = mock(async (_input: { text: string; replyToMessageId: number }) => {})

    prisma.command.findUnique.mockResolvedValue({
      id: 1,
      name: "deploy",
      title: "Deploy",
      description: null,
      parameters: [],
      isProtected: false,
      callbackEndpoint: "https://handler.local",
    } as never)
    commandHandlerClient.invokeCommand.mockRejectedValue(new Error("boom"))

    await handleCommandInvocation({
      prisma,
      authzService,
      permissionRequestService,
      getCommandHandlerClient: () => commandHandlerClient,
      chatId: 1,
      userId: 2,
      messageId: 3,
      text: "/deploy",
      interactionContext: {
        token: "token",
        title: "title",
      },
      sendSystemMessage,
    })

    expect(sendSystemMessage).toHaveBeenCalledWith({
      text: strings.worker.bot.commandReplicaBroken,
      replyToMessageId: 3,
    })
  })

  test("serializes integer and boolean parameters for invocation", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const authzService = mockDeepFn<AuthzServiceClient>()
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    const invokeCommand = mock(async (_input: unknown) => ({}))
    const commandHandlerClient = {
      invokeCommand,
    } as unknown as CommandHandlerServiceClient
    const sendSystemMessage = mock(async (_input: { text: string; replyToMessageId: number }) => {})

    prisma.command.findUnique.mockResolvedValue({
      id: 1,
      name: "deploy",
      title: "Deploy",
      description: null,
      parameters: [
        {
          name: "count",
          title: "Count",
          type: CommandParameterType.INTEGER,
          required: true,
          rest: false,
        },
        {
          name: "enabled",
          title: "Enabled",
          type: CommandParameterType.BOOLEAN,
          required: true,
          rest: false,
        },
      ],
      isProtected: false,
      callbackEndpoint: "https://handler.local",
    } as never)
    await handleCommandInvocation({
      prisma,
      authzService,
      permissionRequestService,
      getCommandHandlerClient: () => commandHandlerClient,
      chatId: 1,
      userId: 2,
      messageId: 3,
      text: "/deploy 42 true",
      interactionContext: {
        token: "token",
        title: "title",
      },
      sendSystemMessage,
    })

    expect(invokeCommand).toHaveBeenCalledTimes(0)
    expect(sendSystemMessage).toHaveBeenCalledWith({
      text: strings.worker.bot.commandReplicaBroken,
      replyToMessageId: 3,
    })
  })
})
