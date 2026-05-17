import type { CommonServices, GenericOperationService } from "@reside/common"
import type { Client } from "@temporalio/client"
import type { Bot, Context } from "grammy"
import type { Update } from "grammy/types"
import type { Operation, PrismaClient } from "../database"
import { createHash } from "node:crypto"
import { logger } from "@reside/common"
import { TELEGRAM_GATEWAY_NAME, TELEGRAM_WEBHOOK_PATH } from "../definitions"
import { createTelegramBot } from "./bot"

export function createWebhookUrl(): string {
  const clusterDomain = process.env.RESIDE_CLUSTER_DOMAIN?.trim()
  if (!clusterDomain || clusterDomain.length === 0) {
    throw new Error(
      '"RESIDE_CLUSTER_DOMAIN" environment variable is required for Telegram webhooks',
    )
  }

  return `https://${TELEGRAM_GATEWAY_NAME}.${clusterDomain}${TELEGRAM_WEBHOOK_PATH}`
}

export function createBotRuntime(args: {
  services: CommonServices<"access"> & {
    prisma: PrismaClient
    operationService: GenericOperationService<Operation>
    temporalClient: Client
  }
  webhookUrl: string
}): {
  reconcile: (
    nextToken: string | undefined,
    nextSystemChatId: string | undefined,
    nextSuperAdminUserId: string | undefined,
  ) => Promise<void>
  handleWebhookUpdate: (webhookSecret: unknown, update: unknown) => Promise<void>
  dispose: () => Promise<void>
} {
  let currentToken: string | undefined
  let currentSystemChatId: string | undefined
  let currentSuperAdminUserId: string | undefined
  let currentBot: Bot<Context> | undefined
  let currentWebhookSecret: string | undefined
  let avatarWebhookTokens = new Map<string, string>()
  let avatarBots = new Map<string, Bot<Context>>()

  const createRuntimeBot = async (token: string): Promise<Bot<Context>> => {
    return await createTelegramBot({
      token,
      prisma: args.services.prisma,
      operationService: args.services.operationService,
      authzService: args.services.authzService,
      permissionRequestService: args.services.permissionRequestService,
      temporalClient: args.services.temporalClient,
      superAdminUserId: currentSuperAdminUserId,
    })
  }

  const routeWebhookUpdate = async (args: {
    update: unknown
    targetBot: Bot<Context>
    malformedPayloadMessage: string
    routingMessage: string
  }): Promise<void> => {
    if (!isTelegramUpdate(args.update)) {
      logger.warn(args.malformedPayloadMessage)
      return
    }

    logger.debug(
      {
        updateId: args.update.update_id,
        updateKinds: getUpdateKinds(args.update),
      },
      args.routingMessage,
    )

    await args.targetBot.handleUpdate(args.update)
  }

  const refreshAvatarWebhookTokens = async (): Promise<void> => {
    avatarWebhookTokens = await loadAvatarWebhookTokens({
      prisma: args.services.prisma,
    })
  }

  const getOrCreateAvatarBot = async (webhookSecret: string): Promise<Bot<Context> | undefined> => {
    const existingBot = avatarBots.get(webhookSecret)
    if (existingBot) {
      return existingBot
    }

    const token = avatarWebhookTokens.get(webhookSecret)
    if (!token) {
      return undefined
    }

    const avatarBot = await createRuntimeBot(token)
    avatarBots.set(webhookSecret, avatarBot)

    logger.debug("created avatar bot runtime instance for webhook secret")

    return avatarBot
  }

  return {
    reconcile: async (
      nextToken: string | undefined,
      nextSystemChatId: string | undefined,
      nextSuperAdminUserId: string | undefined,
    ) => {
      const isMainBotConfigChanged =
        nextToken !== currentToken ||
        nextSystemChatId !== currentSystemChatId ||
        nextSuperAdminUserId !== currentSuperAdminUserId

      currentToken = nextToken
      currentSystemChatId = nextSystemChatId
      currentSuperAdminUserId = nextSuperAdminUserId

      if (isMainBotConfigChanged) {
        currentBot = undefined
        currentWebhookSecret = undefined
        avatarBots = new Map<string, Bot<Context>>()

        if (!nextToken || nextToken.length === 0) {
          logger.info("telegram bot token is not configured, bot stays stopped")
        } else {
          const bot = await createRuntimeBot(nextToken)

          currentWebhookSecret = getWebhookSecret(nextToken)
          await bot.api.setWebhook(args.webhookUrl, {
            secret_token: currentWebhookSecret,
            drop_pending_updates: false,
          })

          currentBot = bot

          logger.info(
            { wekhookUrl: args.webhookUrl },
            "telegram bot instance configured for webhook",
          )
        }
      }
    },
    handleWebhookUpdate: async (webhookSecret: unknown, update: unknown) => {
      if (typeof webhookSecret !== "string" || webhookSecret.length === 0) {
        logger.debug("ignoring webhook update because secret token is missing or invalid")
        return
      }

      if (webhookSecret === currentWebhookSecret && currentBot) {
        await routeWebhookUpdate({
          update,
          targetBot: currentBot,
          malformedPayloadMessage: "received malformed telegram webhook payload",
          routingMessage: "routing webhook update to main telegram bot",
        })
        return
      }

      if (!avatarWebhookTokens.has(webhookSecret)) {
        await refreshAvatarWebhookTokens()
      }

      if (avatarWebhookTokens.has(webhookSecret)) {
        logger.debug("received webhook update for avatar bot secret")

        const avatarBot = await getOrCreateAvatarBot(webhookSecret)
        if (!avatarBot) {
          logger.warn("avatar bot token is missing for webhook secret")
          return
        }

        await routeWebhookUpdate({
          update,
          targetBot: avatarBot,
          malformedPayloadMessage:
            "received malformed telegram webhook payload for avatar bot secret",
          routingMessage: "routing avatar-secret webhook update to avatar telegram bot instance",
        })
        return
      }

      logger.debug(
        {
          hasMainBot: currentBot !== undefined,
          knownAvatarWebhookSecrets: avatarWebhookTokens.size,
        },
        "webhook secret did not match any known bot secret",
      )

      logger.warn("received telegram webhook update with unknown secret token")
    },
    dispose: async () => {
      currentBot = undefined
      currentWebhookSecret = undefined
      avatarWebhookTokens = new Map<string, string>()
      avatarBots = new Map<string, Bot<Context>>()
    },
  }
}

async function loadAvatarWebhookTokens(args: {
  prisma: PrismaClient
}): Promise<Map<string, string>> {
  const avatars = await args.prisma.avatar.findMany({
    select: {
      token: true,
    },
  })

  const nextTokens = new Set(
    avatars.map(avatar => avatar.token?.trim()).filter((token): token is string => !!token),
  )

  logger.debug(
    {
      avatarsCount: avatars.length,
      avatarTokensCount: nextTokens.size,
    },
    "loaded avatar webhook tokens",
  )

  return new Map(Array.from(nextTokens, token => [getWebhookSecret(token), token] as const))
}

function getWebhookSecret(token: string): string {
  return createHash("sha256").update(`telegram-webhook:${token}`).digest("hex")
}

function isTelegramUpdate(value: unknown): value is Update {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const update = value as { update_id?: unknown }
  return typeof update.update_id === "number"
}

function getUpdateKinds(update: Update): string[] {
  const kinds: string[] = []

  if (update.message) {
    kinds.push("message")
  }

  if (update.callback_query) {
    kinds.push("callback_query")
  }

  if (update.edited_message) {
    kinds.push("edited_message")
  }

  if (update.inline_query) {
    kinds.push("inline_query")
  }

  if (update.chosen_inline_result) {
    kinds.push("chosen_inline_result")
  }

  return kinds
}
