import type { Client } from "@temporalio/client"
import type { Bot, Context } from "grammy"
import type { PrismaClient } from "../../database"
import { logger } from "@reside/common"
import { avatarManagedBotCreatedSignal, getAvatarProvisionWorkflowId } from "../../definitions"

export async function handleManagedBotLifecycleUpdate(
  args: {
    prisma: PrismaClient
    temporalClient: Client
  },
  context: Context,
  managerBot: Bot<Context>,
): Promise<void> {
  const managedBotCreated = extractManagedBotCreatedEvent(context.update)
  if (managedBotCreated) {
    await handleManagedBotCreated(args, context, managedBotCreated)
  }

  const managedBotUpdated = extractManagedBotUpdatedEvent(context.update)
  if (managedBotUpdated) {
    await handleManagedBotUpdated(args, managerBot, managedBotUpdated)
  }
}

async function handleManagedBotCreated(
  args: {
    prisma: PrismaClient
    temporalClient: Client
  },
  context: Context,
  managedBotCreated: {
    managedBotId: string
    managedBotUsername: string
  },
): Promise<void> {
  const createdByUserId = await resolveCreatorUserId(args.prisma, context.from)

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
      token: nextToken,
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
  prisma: PrismaClient,
  user: Context["from"] | undefined,
): Promise<number | null> {
  if (!user?.id) {
    return null
  }

  const userEntity = await prisma.user.upsert({
    where: {
      telegramId: String(user.id),
    },
    create: {
      telegramId: String(user.id),
      data: user as unknown as PrismaJson.UserData,
    },
    update: {
      data: user as unknown as PrismaJson.UserData,
    },
    select: {
      id: true,
    },
  })

  return userEntity.id
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
