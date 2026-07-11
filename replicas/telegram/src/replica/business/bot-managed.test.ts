import type { Context } from "grammy"
import type { PrismaClient } from "../../database"
import { describe, expect, mock, test } from "bun:test"
import { mockDeepFn, testCrypto } from "@reside/common/testing"
import {
  extractAvatarBotJoinedChatEvents,
  extractManagedBotCreatedEvent,
  extractManagedBotUpdatedEvent,
  handleManagedBotLifecycleUpdate,
  isManagedBotUsernameAccepted,
  isManagedBotUsernamePattern,
} from "./bot-managed"

describe("extractManagedBotCreatedEvent", () => {
  test("extracts managed bot identity from direct message payload", () => {
    const payload = {
      message: {
        managed_bot_created: {
          id: 10,
          username: "reside_alpha_bot",
        },
      },
    }

    expect(extractManagedBotCreatedEvent(payload)).toEqual({
      managedBotId: "10",
      managedBotUsername: "reside_alpha_bot",
    })
  })

  test("extracts managed bot identity from nested bot payload", () => {
    const payload = {
      message: {
        managedBotCreated: {
          bot: {
            id: "11",
            username: "reside_beta_bot",
          },
        },
      },
    }

    expect(extractManagedBotCreatedEvent(payload)).toEqual({
      managedBotId: "11",
      managedBotUsername: "reside_beta_bot",
    })
  })

  test("returns undefined for malformed payload", () => {
    expect(extractManagedBotCreatedEvent({ message: {} })).toBeUndefined()
  })
})

describe("extractManagedBotUpdatedEvent", () => {
  test("extracts managed bot identity", () => {
    const payload = {
      managed_bot: {
        id: 15,
        username: "reside_gamma_bot",
      },
    }

    expect(extractManagedBotUpdatedEvent(payload)).toEqual({
      managedBotId: "15",
      managedBotUsername: "reside_gamma_bot",
    })
  })

  test("returns undefined for malformed payload", () => {
    expect(extractManagedBotUpdatedEvent({ managed_bot: {} })).toBeUndefined()
  })
})

describe("extractAvatarBotJoinedChatEvents", () => {
  test("extracts bot members added to chat", () => {
    const payload = {
      message: {
        chat: {
          id: -100123,
        },
        new_chat_members: [
          {
            id: 101,
            username: "reside_alpha_helper_bot",
            is_bot: true,
          },
          {
            id: 102,
            username: "human_user",
            is_bot: false,
          },
        ],
      },
    }

    expect(extractAvatarBotJoinedChatEvents(payload)).toEqual([
      {
        chatId: -100123,
        managedBotId: "101",
        managedBotUsername: "reside_alpha_helper_bot",
      },
    ])
  })

  test("returns empty list for malformed payload", () => {
    expect(extractAvatarBotJoinedChatEvents({})).toEqual([])
  })
})

describe("handleManagedBotLifecycleUpdate", () => {
  test("promotes known avatar bot when it is added to chat", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    prisma.avatar.findFirst.mockResolvedValue({ id: 77 } as never)

    const promoteChatMember = mock(async () => true)
    const managerBot = {
      api: {
        promoteChatMember,
      },
    } as unknown as {
      api: {
        promoteChatMember: (
          chatId: number | string,
          userId: number,
          permissions: Record<string, boolean>,
        ) => Promise<boolean>
      }
    }

    const context = {
      update: {
        message: {
          chat: {
            id: -1001,
          },
          new_chat_members: [
            {
              id: 123,
              username: "reside_alpha_bot",
              is_bot: true,
            },
          ],
        },
      },
    } as unknown as Context

    await handleManagedBotLifecycleUpdate(
      {
        crypto: testCrypto,
        prisma,
        temporalClient: mockDeepFn(),
      },
      context,
      managerBot as never,
    )

    expect(prisma.avatar.findFirst.spy()).toHaveBeenCalledTimes(1)
    expect(promoteChatMember).toHaveBeenCalledWith(
      -1001,
      123,
      expect.objectContaining({
        can_manage_chat: true,
        can_change_info: true,
        can_promote_members: false,
      }),
    )
  })

  test("does not promote unknown bot", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    prisma.avatar.findFirst.mockResolvedValue(null as never)

    const promoteChatMember = mock(async () => true)
    const managerBot = {
      api: {
        promoteChatMember,
      },
    } as unknown as {
      api: {
        promoteChatMember: (
          chatId: number | string,
          userId: number,
          permissions: Record<string, boolean>,
        ) => Promise<boolean>
      }
    }

    const context = {
      update: {
        message: {
          chat: {
            id: -1001,
          },
          new_chat_members: [
            {
              id: 456,
              username: "some_other_bot",
              is_bot: true,
            },
          ],
        },
      },
    } as unknown as Context

    await handleManagedBotLifecycleUpdate(
      {
        crypto: testCrypto,
        prisma,
        temporalClient: mockDeepFn(),
      },
      context,
      managerBot as never,
    )

    expect(prisma.avatar.findFirst.spy()).toHaveBeenCalledTimes(1)
    expect(promoteChatMember).toHaveBeenCalledTimes(0)
  })
})

describe("managed bot username helpers", () => {
  test("validates accepted usernames", () => {
    expect(isManagedBotUsernameAccepted("reside_alpha_helper_bot", "reside_alpha")).toBeTrue()
    expect(isManagedBotUsernameAccepted("alpha_bot", "reside_alpha")).toBeFalse()
    expect(isManagedBotUsernameAccepted("reside_alpha", "reside_alpha")).toBeFalse()
  })

  test("validates managed bot username pattern", () => {
    expect(isManagedBotUsernamePattern("reside_alpha_bot")).toBeTrue()
    expect(isManagedBotUsernamePattern("reside_alpha")).toBeFalse()
  })
})
