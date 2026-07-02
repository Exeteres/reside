import type { SubjectServiceClient } from "@reside/api/common/subject.v1"
import type { CommonServices, GenericOperationService } from "@reside/common"
import type { ResideCrypto } from "@reside/common/encryption"
import type { Client } from "@temporalio/client"
import type { Bot, Context } from "grammy"
import type { Update } from "grammy/types"
import type { Operation, PrismaClient } from "../../database"
import { createHash } from "node:crypto"
import { logger } from "@reside/common"
import {
  AVATAR_BOT_CONFIG_UPDATE_DELAY_MS,
  AVATAR_BOT_CONFIG_VERSION,
  AVATAR_WEBHOOK_ALLOWED_UPDATES,
  encryptedStringSchema,
  TELEGRAM_WEBHOOK_PATH,
} from "../../definitions"
import { createTelegramBot } from "./bot"
import { createTelegramBotClient } from "./bot-client"

type AvatarBotConfigClientFactory = (
  token: string,
  args: { role?: string },
) => {
  api: {
    setWebhook(
      url: string,
      options: {
        secret_token: string
        drop_pending_updates: boolean
        allowed_updates: readonly (typeof AVATAR_WEBHOOK_ALLOWED_UPDATES)[number][]
      },
    ): Promise<unknown>
  }
}

export function createWebhookUrl(endpoint: string): string {
  const normalizedEndpoint = endpoint.trim()
  if (normalizedEndpoint.length === 0) {
    throw new Error("Telegram gateway endpoint is required for webhooks")
  }

  return `https://${normalizedEndpoint}${TELEGRAM_WEBHOOK_PATH}`
}

export function createBotRuntime(args: {
  services: CommonServices<"access" | "alpha"> & {
    prisma: PrismaClient
    operationService: GenericOperationService<Operation>
    temporalClient: Client
    subjectService: SubjectServiceClient
    crypto: ResideCrypto
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
      discoveryService: args.services.discoveryService,
      authzService: args.services.authzService,
      permissionRequestService: args.services.permissionRequestService,
      subjectService: args.services.subjectService,
      temporalClient: args.services.temporalClient,
      superAdminUserId: currentSuperAdminUserId,
      crypto: args.services.crypto,
    })
  }

  const routeWebhookUpdate = async (args: {
    update: unknown
    targetBot: Bot<Context>
    malformedPayloadMessage: string
    targetName: string
  }): Promise<void> => {
    if (!isTelegramUpdate(args.update)) {
      logger.warn(args.malformedPayloadMessage)
      return
    }

    logger.debug(
      'routing telegram webhook update target="%s" update_id="%s" update_kinds="%s" update_summary="%s"',
      args.targetName,
      String(args.update.update_id),
      getUpdateKinds(args.update).join(","),
      getUpdateSummary(args.update).join(","),
    )

    await args.targetBot.handleUpdate(args.update)
  }

  const refreshAvatarWebhookTokens = async (): Promise<void> => {
    avatarWebhookTokens = await loadAvatarWebhookTokens({
      crypto: args.services.crypto,
      prisma: args.services.prisma,
    })

    await reconcileAvatarBotConfigurations(
      args.services.prisma,
      args.services.crypto,
      createTelegramBotClient,
      Bun.sleep,
      args.webhookUrl,
    )
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

      await refreshAvatarWebhookTokens()
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
          targetName: "main",
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
          targetName: "avatar",
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
  crypto: ResideCrypto
  prisma: PrismaClient
}): Promise<Map<string, string>> {
  const avatars = await args.prisma.avatar.findMany({
    select: {
      tokenEcid: true,
    },
  })

  const nextTokens = new Set<string>()
  for (const avatar of avatars) {
    const token = (await args.crypto.decrypt(encryptedStringSchema, avatar.tokenEcid)).trim()
    if (token.length > 0) {
      nextTokens.add(token)
    }
  }

  logger.debug(
    {
      avatarsCount: avatars.length,
      avatarTokensCount: nextTokens.size,
    },
    "loaded avatar webhook tokens",
  )

  return new Map(Array.from(nextTokens, token => [getWebhookSecret(token), token] as const))
}

export async function reconcileAvatarBotConfigurations(
  prisma: PrismaClient,
  crypto: ResideCrypto,
  createBotClient: AvatarBotConfigClientFactory,
  sleep: (milliseconds: number) => Promise<unknown>,
  webhookUrl: string,
): Promise<void> {
  const staleAvatars = await prisma.avatar.findMany({
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

  if (staleAvatars.length === 0) {
    return
  }

  logger.info(
    'reconciling stale avatar bot configurations stale_avatar_count="%s" target_config_version="%s"',
    String(staleAvatars.length),
    String(AVATAR_BOT_CONFIG_VERSION),
  )

  for (const [index, avatar] of staleAvatars.entries()) {
    if (index > 0) {
      await sleep(AVATAR_BOT_CONFIG_UPDATE_DELAY_MS)
    }

    try {
      const token = (await crypto.decrypt(encryptedStringSchema, avatar.tokenEcid)).trim()
      if (token.length === 0) {
        logger.warn(
          'skipping avatar bot configuration because token is empty avatar_id="%s" replica_name="%s"',
          String(avatar.id),
          avatar.replicaName,
        )
        continue
      }

      const avatarBot = createBotClient(token, {
        role: "runtime.avatar-config",
      })

      await avatarBot.api.setWebhook(webhookUrl, {
        secret_token: getWebhookSecret(token),
        drop_pending_updates: false,
        allowed_updates: [...AVATAR_WEBHOOK_ALLOWED_UPDATES],
      })

      await prisma.avatar.update({
        where: {
          id: avatar.id,
        },
        data: {
          configVersion: AVATAR_BOT_CONFIG_VERSION,
        },
      })

      logger.info(
        'reconciled avatar bot configuration avatar_id="%s" replica_name="%s" config_version="%s"',
        String(avatar.id),
        avatar.replicaName,
        String(AVATAR_BOT_CONFIG_VERSION),
      )
    } catch (error) {
      logger.warn(
        {
          error: error instanceof Error ? error : new Error(String(error)),
        },
        'failed to reconcile avatar bot configuration avatar_id="%s" replica_name="%s"',
        String(avatar.id),
        avatar.replicaName,
      )
    }
  }
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

const TELEGRAM_UPDATE_KIND_KEYS = [
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
  "business_connection",
  "business_message",
  "edited_business_message",
  "deleted_business_messages",
  "message_reaction",
  "message_reaction_count",
  "inline_query",
  "chosen_inline_result",
  "callback_query",
  "shipping_query",
  "pre_checkout_query",
  "purchased_paid_media",
  "poll",
  "poll_answer",
  "my_chat_member",
  "chat_member",
  "chat_join_request",
  "chat_boost",
  "removed_chat_boost",
] as const

const TELEGRAM_MESSAGE_KIND_KEYS = [
  "text",
  "animation",
  "audio",
  "document",
  "paid_media",
  "photo",
  "sticker",
  "story",
  "video",
  "video_note",
  "voice",
  "caption",
  "contact",
  "dice",
  "game",
  "poll",
  "venue",
  "location",
  "new_chat_members",
  "left_chat_member",
  "new_chat_title",
  "new_chat_photo",
  "delete_chat_photo",
  "group_chat_created",
  "supergroup_chat_created",
  "channel_chat_created",
  "message_auto_delete_timer_changed",
  "migrate_to_chat_id",
  "migrate_from_chat_id",
  "pinned_message",
  "invoice",
  "successful_payment",
  "refunded_payment",
  "users_shared",
  "chat_shared",
  "connected_website",
  "write_access_allowed",
  "passport_data",
  "proximity_alert_triggered",
  "boost_added",
  "chat_background_set",
  "forum_topic_created",
  "forum_topic_edited",
  "forum_topic_closed",
  "forum_topic_reopened",
  "general_forum_topic_hidden",
  "general_forum_topic_unhidden",
  "giveaway_created",
  "giveaway",
  "giveaway_winners",
  "giveaway_completed",
  "video_chat_scheduled",
  "video_chat_started",
  "video_chat_ended",
  "video_chat_participants_invited",
  "web_app_data",
] as const

function getUpdateKinds(update: Update): string[] {
  const updateRecord = update as unknown as Record<string, unknown>
  return TELEGRAM_UPDATE_KIND_KEYS.filter(key => updateRecord[key] !== undefined)
}

function getUpdateSummary(update: Update): string[] {
  const updateRecord = update as unknown as Record<string, unknown>
  const summary: string[] = []

  for (const messageKey of [
    "message",
    "edited_message",
    "channel_post",
    "edited_channel_post",
    "business_message",
    "edited_business_message",
  ]) {
    const messageSummary = getMessageSummary(updateRecord[messageKey])
    if (messageSummary.length > 0) {
      summary.push(`${messageKey}:${messageSummary.join("+")}`)
    }
  }

  const callbackQuery = toRecord(updateRecord.callback_query)
  if (callbackQuery) {
    summary.push(`callback_has_data:${typeof callbackQuery.data === "string"}`)
    summary.push(`callback_has_message:${callbackQuery.message !== undefined}`)
  }

  const poll = toRecord(updateRecord.poll)
  const pollOptions = Array.isArray(poll?.options) ? poll.options : []
  if (poll) {
    summary.push(`poll_options:${pollOptions.length}`)
    summary.push(`poll_allows_multiple_answers:${poll.allows_multiple_answers === true}`)
  }

  const pollAnswer = toRecord(updateRecord.poll_answer)
  const pollAnswerOptions = Array.isArray(pollAnswer?.option_ids) ? pollAnswer.option_ids : []
  if (pollAnswer) {
    summary.push(`poll_answer_options:${pollAnswerOptions.length}`)
  }

  const deletedBusinessMessages = toRecord(updateRecord.deleted_business_messages)
  const deletedMessageIds = Array.isArray(deletedBusinessMessages?.message_ids)
    ? deletedBusinessMessages.message_ids
    : []
  if (deletedBusinessMessages) {
    summary.push(`deleted_business_messages_count:${deletedMessageIds.length}`)
  }

  return summary.length === 0 ? ["none"] : summary
}

function getMessageSummary(value: unknown): string[] {
  const message = toRecord(value)
  if (!message) {
    return []
  }

  const summary: string[] = TELEGRAM_MESSAGE_KIND_KEYS.filter(key => message[key] !== undefined)
  if (Array.isArray(message.entities)) {
    summary.push(`entities:${message.entities.length}`)
  }

  if (Array.isArray(message.caption_entities)) {
    summary.push(`caption_entities:${message.caption_entities.length}`)
  }

  if (Array.isArray(message.photo)) {
    summary.push(`photo_sizes:${message.photo.length}`)
  }

  const poll = toRecord(message.poll)
  if (Array.isArray(poll?.options)) {
    summary.push(`poll_options:${poll.options.length}`)
  }

  return summary
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined
  }

  return value as Record<string, unknown>
}
