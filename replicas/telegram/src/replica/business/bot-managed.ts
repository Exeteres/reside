import type { ResideCrypto } from "@reside/common/encryption"
import type { Client } from "@temporalio/client"
import type { Bot, Context } from "grammy"
import type { PrismaClient } from "../../database"
import { logger, rhid } from "@reside/common"
import {
  AVATAR_BOT_CONFIG_VERSION,
  avatarManagedBotCreatedSignal,
  encryptedStringSchema,
  getAvatarProvisionWorkflowId,
} from "../../definitions"

type AvatarBotJoinedChatEvent = {
  chatId: string | number
  managedBotId: string
  managedBotUsername: string | undefined
}

const AVATAR_MINIMAL_ADMIN_PERMISSIONS = {
  can_manage_chat: true,
  can_delete_messages: false,
  can_manage_video_chats: false,
  can_restrict_members: false,
  can_promote_members: false,
  can_change_info: false,
  can_invite_users: false,
  can_post_messages: false,
  can_edit_messages: false,
  can_pin_messages: false,
  can_manage_topics: false,
  is_anonymous: false,
}

export async function handleManagedBotLifecycleUpdate(
  args: {
    prisma: PrismaClient
    temporalClient: Client
    crypto: ResideCrypto
  },
  context: Context,
  managerBot: Bot<Context>,
): Promise<void> {
  const avatarBotJoinedEvents = extractAvatarBotJoinedChatEvents(context.update)
  if (avatarBotJoinedEvents.length > 0) {
    await handleAvatarBotJoinedChats(args, managerBot, avatarBotJoinedEvents)
  }

  const managedBotCreated = extractManagedBotCreatedEvent(context.update)
  if (managedBotCreated) {
    await handleManagedBotCreated(args, context, managedBotCreated)
  }

  const managedBotUpdated = extractManagedBotUpdatedEvent(context.update)
  if (managedBotUpdated) {
    await handleManagedBotUpdated(args, managerBot, managedBotUpdated)
  }
}

async function handleAvatarBotJoinedChats(
  args: {
    prisma: PrismaClient
  },
  managerBot: Bot<Context>,
  joinedEvents: AvatarBotJoinedChatEvent[],
): Promise<void> {
  for (const joinedEvent of joinedEvents) {
    const avatar = await findAvatarByBotIdentity(args.prisma, joinedEvent)
    if (!avatar) {
      continue
    }

    const managedBotId = Number(joinedEvent.managedBotId)
    if (!Number.isInteger(managedBotId)) {
      continue
    }

    await managerBot.api.promoteChatMember(
      joinedEvent.chatId,
      managedBotId,
      AVATAR_MINIMAL_ADMIN_PERMISSIONS,
    )

    logger.info(
      {
        avatarId: avatar.id,
        chatId: joinedEvent.chatId,
        managedBotId,
      },
      "promoted avatar bot to admin with minimal permissions",
    )
  }
}

async function findAvatarByBotIdentity(
  prisma: PrismaClient,
  joinedEvent: AvatarBotJoinedChatEvent,
): Promise<{ id: number } | null> {
  const managedBotUsername = joinedEvent.managedBotUsername?.trim()

  const orClauses = [
    {
      managedBotId: joinedEvent.managedBotId,
    },
    ...(managedBotUsername
      ? [
          {
            managedBotUsername,
          },
        ]
      : []),
  ]

  return await prisma.avatar.findFirst({
    where: {
      OR: orClauses,
    },
    select: {
      id: true,
    },
  })
}

async function handleManagedBotCreated(
  args: {
    prisma: PrismaClient
    temporalClient: Client
    crypto: ResideCrypto
  },
  context: Context,
  managedBotCreated: {
    managedBotId: string
    managedBotUsername: string
  },
): Promise<void> {
  const createdByUserId = await resolveCreatorUserId(args.crypto, args.prisma, context.from)

  const pendingRequests = await args.prisma.avatarProvisionRequest.findMany({
    where: {
      operation: {
        status: "PENDING",
      },
    },
    select: {
      operationId: true,
      expectedPrefix: true,
      replicaName: true,
    },
  })

  const matchedRequest = pendingRequests.find(request => {
    return isManagedBotUsernameAccepted(
      managedBotCreated.managedBotUsername,
      request.expectedPrefix,
    )
  })

  if (!matchedRequest) {
    const followsManagedBotPattern = isManagedBotUsernamePattern(
      managedBotCreated.managedBotUsername,
    )

    await args.prisma.unauthorizedAvatar.create({
      data: {
        managedBotId: managedBotCreated.managedBotId,
        managedBotUsername: managedBotCreated.managedBotUsername,
        createdByUserId,
        reason: followsManagedBotPattern ? "NO_PENDING_REQUEST" : "INVALID_PATTERN",
      },
    })
    return
  }

  await args.prisma.avatarProvisionRequest.update({
    where: {
      operationId: matchedRequest.operationId,
    },
    data: {
      createdByUserId,
    },
  })

  const handle = args.temporalClient.workflow.getHandle(
    getAvatarProvisionWorkflowId(matchedRequest.operationId),
  )

  await handle.signal(avatarManagedBotCreatedSignal, {
    managedBotId: managedBotCreated.managedBotId,
    managedBotUsername: managedBotCreated.managedBotUsername,
  })
}

async function handleManagedBotUpdated(
  args: {
    prisma: PrismaClient
    crypto: ResideCrypto
  },
  managerBot: Bot<Context>,
  managedBotUpdated: {
    managedBotId: string
    managedBotUsername: string
  },
): Promise<void> {
  const avatarById = await args.prisma.avatar.findFirst({
    where: {
      managedBotId: managedBotUpdated.managedBotId,
    },
    select: {
      id: true,
    },
  })

  const avatarByUsername =
    avatarById !== null
      ? null
      : await args.prisma.avatar.findFirst({
          where: {
            managedBotUsername: managedBotUpdated.managedBotUsername,
          },
          select: {
            id: true,
          },
        })

  const avatar = avatarById ?? avatarByUsername

  if (!avatar) {
    return
  }

  if (avatarByUsername !== null) {
    const conflictingAvatar = await args.prisma.avatar.findFirst({
      where: {
        managedBotId: managedBotUpdated.managedBotId,
        id: {
          not: avatar.id,
        },
      },
      select: {
        id: true,
      },
    })

    if (conflictingAvatar) {
      logger.warn(
        "managed bot update points to id %s that is already linked to avatar %s",
        managedBotUpdated.managedBotId,
        conflictingAvatar.id,
      )
      return
    }
  }

  const managedBotId = Number(managedBotUpdated.managedBotId)
  if (!Number.isInteger(managedBotId)) {
    return
  }

  const nextToken = await managerBot.api.getManagedBotToken(managedBotId)

  if (!nextToken || nextToken.length === 0) {
    return
  }

  await args.prisma.avatar.update({
    where: {
      id: avatar.id,
    },
    data: {
      managedBotId: managedBotUpdated.managedBotId,
      managedBotUsername: managedBotUpdated.managedBotUsername,
      tokenEcid: await args.crypto.encrypt(nextToken),
      configVersion: AVATAR_BOT_CONFIG_VERSION - 1,
    },
  })
}

export function extractManagedBotCreatedEvent(update: unknown):
  | {
      managedBotId: string
      managedBotUsername: string
    }
  | undefined {
  if (!isRecord(update)) {
    return undefined
  }

  const message = toRecord(update.message)
  const payload = toRecord(message?.managed_bot_created ?? message?.managedBotCreated)
  if (!payload) {
    return undefined
  }

  return extractManagedBotIdentity(payload)
}

export function extractManagedBotUpdatedEvent(update: unknown):
  | {
      managedBotId: string
      managedBotUsername: string
    }
  | undefined {
  if (!isRecord(update)) {
    return undefined
  }

  const payload = toRecord(update.managed_bot ?? update.managedBot)
  if (!payload) {
    return undefined
  }

  const identity = extractManagedBotIdentity(payload)
  if (!identity) {
    return undefined
  }

  return {
    managedBotId: identity.managedBotId,
    managedBotUsername: identity.managedBotUsername,
  }
}

export function extractAvatarBotJoinedChatEvents(update: unknown): AvatarBotJoinedChatEvent[] {
  if (!isRecord(update)) {
    return []
  }

  const message = toRecord(update.message)
  const messageChat = toRecord(message?.chat)
  const chatId = toStringOrNumberValue(messageChat?.id)

  if (chatId === undefined) {
    return []
  }

  const newChatMembers = toRecordArray(message?.new_chat_members ?? message?.newChatMembers)
  if (newChatMembers.length === 0) {
    return []
  }

  return newChatMembers
    .filter(member => member.is_bot === true || member.isBot === true)
    .map(member => {
      return {
        chatId,
        managedBotId: toStringValue(member.id) ?? "",
        managedBotUsername: toStringValue(member.username),
      }
    })
    .filter(event => event.managedBotId.length > 0)
}

function extractManagedBotIdentity(payload: Record<string, unknown>):
  | {
      managedBotId: string
      managedBotUsername: string
    }
  | undefined {
  const directId = toStringValue(payload.id)
  const directUsername = toStringValue(payload.username)

  if (directId && directUsername) {
    return {
      managedBotId: directId,
      managedBotUsername: directUsername,
    }
  }

  const bot = toRecord(payload.bot)
  const botId = toStringValue(bot?.id)
  const botUsername = toStringValue(bot?.username)

  if (botId && botUsername) {
    return {
      managedBotId: botId,
      managedBotUsername: botUsername,
    }
  }

  return undefined
}

export function isManagedBotUsernameAccepted(
  candidateUsername: string,
  expectedPrefix: string,
): boolean {
  if (!candidateUsername.endsWith("_bot")) {
    return false
  }

  return candidateUsername.startsWith(`${expectedPrefix}_`)
}

export function isManagedBotUsernamePattern(username: string): boolean {
  return username.startsWith("reside_") && username.endsWith("_bot")
}

async function resolveCreatorUserId(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  user: Context["from"] | undefined,
): Promise<number | null> {
  if (!user?.id) {
    return null
  }

  const telegramRhid = rhid(String(user.id))
  const telegramUserId = String(user.id)
  const username = toOptionalNonEmptyString(user.username)
  const firstName = toOptionalNonEmptyString(user.first_name)
  const lastName = toOptionalNonEmptyString(user.last_name)

  const existingUser = await prisma.user.findUnique({
    where: {
      telegramRhid,
    },
    select: {
      id: true,
      telegramUserIdEcid: true,
      usernameEcid: true,
      firstNameEcid: true,
      lastNameEcid: true,
    },
  })

  if (!existingUser) {
    const userEntity = await prisma.user.create({
      data: {
        telegramRhid,
        telegramUserIdEcid: await crypto.encrypt(telegramUserId),
        usernameEcid: username === undefined ? null : await crypto.encrypt(username),
        firstNameEcid: firstName === undefined ? null : await crypto.encrypt(firstName),
        lastNameEcid: lastName === undefined ? null : await crypto.encrypt(lastName),
      },
      select: {
        id: true,
      },
    })

    return userEntity.id
  }

  const updateData: {
    telegramUserIdEcid?: string
    usernameEcid?: string | null
    firstNameEcid?: string | null
    lastNameEcid?: string | null
  } = {}

  const currentTelegramUserId = await crypto.decrypt(
    encryptedStringSchema,
    existingUser.telegramUserIdEcid,
  )
  if (currentTelegramUserId !== telegramUserId) {
    updateData.telegramUserIdEcid = await crypto.encrypt(telegramUserId)
  }

  const currentUsername = await decryptOptionalString(crypto, existingUser.usernameEcid)
  if (currentUsername !== username) {
    updateData.usernameEcid = username === undefined ? null : await crypto.encrypt(username)
  }

  const currentFirstName = await decryptOptionalString(crypto, existingUser.firstNameEcid)
  if (currentFirstName !== firstName) {
    updateData.firstNameEcid = firstName === undefined ? null : await crypto.encrypt(firstName)
  }

  const currentLastName = await decryptOptionalString(crypto, existingUser.lastNameEcid)
  if (currentLastName !== lastName) {
    updateData.lastNameEcid = lastName === undefined ? null : await crypto.encrypt(lastName)
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.user.update({
      where: {
        telegramRhid,
      },
      data: updateData,
      select: {
        id: true,
      },
    })
  }

  return existingUser.id
}

async function decryptOptionalString(
  crypto: ResideCrypto,
  ecid: string | null,
): Promise<string | undefined> {
  if (ecid === null) {
    return undefined
  }

  return await crypto.decrypt(encryptedStringSchema, ecid)
}

function toOptionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const normalized = value.trim()
  if (normalized.length === 0) {
    return undefined
  }

  return normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  return value
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value
  }

  if (typeof value === "number") {
    return String(value)
  }

  return undefined
}

function toStringOrNumberValue(value: unknown): string | number | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return value
  }

  return undefined
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isRecord)
}
