import type { PrismaClient } from "../../database"
import { describe, expect, mock, test } from "bun:test"
import { mockDeepFn, testCrypto } from "@reside/common/testing"
import {
  AVATAR_BOT_CONFIG_UPDATE_DELAY_MS,
  AVATAR_BOT_CONFIG_VERSION,
  AVATAR_WEBHOOK_ALLOWED_UPDATES,
  TELEGRAM_WEBHOOK_PATH,
} from "../../definitions"
import { createWebhookUrl, reconcileAvatarBotConfigurations } from "./bot-runtime"

describe("createWebhookUrl", () => {
  test("throws when endpoint is empty", () => {
    expect(() => createWebhookUrl("   ")).toThrow(
      "Telegram gateway endpoint is required for webhooks",
    )
  })

  test("builds webhook URL from endpoint", () => {
    const webhookUrl = createWebhookUrl("telegram.example.local")

    expect(webhookUrl).toBe(`https://telegram.example.local${TELEGRAM_WEBHOOK_PATH}`)
  })
})

describe("AVATAR_WEBHOOK_ALLOWED_UPDATES", () => {
  test("subscribes avatars to callbacks and poll answers", () => {
    expect(AVATAR_WEBHOOK_ALLOWED_UPDATES).toEqual(["callback_query", "poll_answer"])
  })
})

describe("reconcileAvatarBotConfigurations", () => {
  test("updates only avatars below current config version", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    prisma.avatar.findMany.mockResolvedValue([])
    const createBotClient = mock()

    await reconcileAvatarBotConfigurations(
      prisma,
      testCrypto,
      createBotClient,
      async () => {},
      "https://telegram.example.local/webhook",
    )

    expect(prisma.avatar.findMany.spy()).toHaveBeenCalledWith({
      where: {
        configVersion: {
          lt: AVATAR_BOT_CONFIG_VERSION,
        },
      },
      orderBy: {
        id: "asc",
      },
      select: {
        id: true,
        replicaName: true,
        tokenEcid: true,
      },
    })
    expect(createBotClient).not.toHaveBeenCalled()
  })

  test("applies stale avatar configs sequentially with delay", async () => {
    const firstTokenEcid = await testCrypto.encrypt("first-token")
    const secondTokenEcid = await testCrypto.encrypt("second-token")
    const prisma = mockDeepFn<PrismaClient>()
    prisma.avatar.findMany.mockResolvedValue([
      {
        id: 10,
        replicaName: "alpha",
        tokenEcid: firstTokenEcid,
      },
      {
        id: 11,
        replicaName: "bank",
        tokenEcid: secondTokenEcid,
      },
    ] as never)

    const setWebhook = mock(async () => {})
    const createBotClient = mock((token: string, args: { role?: string }) => {
      return {
        token,
        args,
        api: {
          setWebhook,
        },
      }
    })
    const sleeps: number[] = []

    await reconcileAvatarBotConfigurations(
      prisma,
      testCrypto,
      createBotClient,
      async milliseconds => {
        sleeps.push(milliseconds)
      },
      "https://telegram.example.local/webhook",
    )

    expect(sleeps).toEqual([AVATAR_BOT_CONFIG_UPDATE_DELAY_MS])
    expect(createBotClient).toHaveBeenNthCalledWith(1, "first-token", {
      role: "runtime.avatar-config",
    })
    expect(createBotClient).toHaveBeenNthCalledWith(2, "second-token", {
      role: "runtime.avatar-config",
    })
    expect(setWebhook).toHaveBeenCalledTimes(2)
    expect(setWebhook).toHaveBeenNthCalledWith(1, "https://telegram.example.local/webhook", {
      secret_token: expect.any(String),
      drop_pending_updates: false,
      allowed_updates: [...AVATAR_WEBHOOK_ALLOWED_UPDATES],
    })
    expect(setWebhook).toHaveBeenNthCalledWith(2, "https://telegram.example.local/webhook", {
      secret_token: expect.any(String),
      drop_pending_updates: false,
      allowed_updates: [...AVATAR_WEBHOOK_ALLOWED_UPDATES],
    })
    expect(prisma.avatar.update.spy()).toHaveBeenNthCalledWith(1, {
      where: {
        id: 10,
      },
      data: {
        configVersion: AVATAR_BOT_CONFIG_VERSION,
      },
    })
    expect(prisma.avatar.update.spy()).toHaveBeenNthCalledWith(2, {
      where: {
        id: 11,
      },
      data: {
        configVersion: AVATAR_BOT_CONFIG_VERSION,
      },
    })
  })
})
