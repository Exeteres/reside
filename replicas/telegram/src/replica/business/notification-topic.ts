import type { ResideCrypto } from "@reside/common/encryption"
import type { PrismaClient } from "../../database"
import type { AuthzServiceClientLike, TelegramBotLike } from "./notification-types"
import { Code, ConnectError } from "@connectrpc/connect"
import { rhid } from "@reside/common"
import {
  encryptedStringSchema,
  telegramChatDataSchema,
  telegramTopicThreadSchema,
} from "../../definitions"
import { ensureTargetChatExists, resolveSenderSubjectId } from "./notification-access"

export type NotificationTopicDeliveryConfig = {
  botToken: string
  systemChatId: string
}

export async function createNotificationTopicForReplica(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  authzService: AuthzServiceClientLike,
  createTelegramBotClient: (token: string, args: { role: string }) => TelegramBotLike,
  loadDeliveryConfig: () => Promise<NotificationTopicDeliveryConfig>,
  replicaName: string,
  input: {
    channel: string
    title: string
    createAsSubjectId?: string
  },
): Promise<{ topicId: string }> {
  const title = input.title.trim()
  if (title.length === 0) {
    throw new ConnectError("Topic title must not be empty", Code.InvalidArgument)
  }

  const channel = await prisma.notificationChannel.findUnique({
    where: {
      name: input.channel,
    },
  })

  if (!channel) {
    throw new ConnectError(`Channel with name "${input.channel}" was not found`, Code.NotFound)
  }

  const replicaSubjectId = `replica:${replicaName}`
  const creatorSubjectId = await resolveSenderSubjectId(
    authzService,
    replicaSubjectId,
    input.createAsSubjectId,
  )
  const deliveryConfig = await loadDeliveryConfig()
  const targetChatId = await resolveTopicCreationChatId(
    crypto,
    prisma,
    channel.id,
    deliveryConfig.systemChatId,
  )
  const botToken = await resolveTopicBotToken(
    crypto,
    prisma,
    creatorSubjectId,
    deliveryConfig.botToken,
  )
  const bot = createTelegramBotClient(botToken, {
    role: "topic.create",
  })
  if (!bot.api.createForumTopic) {
    throw new ConnectError("Telegram bot client does not support topic creation", Code.Internal)
  }

  const topic = await bot.api.createForumTopic(targetChatId, title)
  const targetChat = await ensureTargetChatExists(crypto, prisma, targetChatId)
  const threadEcid = await crypto.encrypt({
    chat_id: targetChatId,
    message_thread_id: topic.message_thread_id,
  })

  const notificationTopic = await prisma.notificationTopic.create({
    data: {
      chatId: targetChat.id,
      channelId: channel.id,
      threadRhid: rhid(topic.message_thread_id),
      threadEcid,
      creatorSubjectId,
      title,
    },
    select: {
      id: true,
    },
  })

  return {
    topicId: String(notificationTopic.id),
  }
}

async function resolveTopicCreationChatId(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  channelId: number,
  systemChatId: string,
): Promise<string> {
  const binding = await prisma.notificationChannelBinding.findUnique({
    where: {
      channelId,
    },
    select: {
      chat: {
        select: {
          dataEcid: true,
        },
      },
    },
  })

  if (binding === null) {
    return systemChatId
  }

  const chat = await crypto.decrypt(telegramChatDataSchema, binding.chat.dataEcid)

  return String(chat.id)
}

export async function updateNotificationTopicForReplica(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  createTelegramBotClient: (token: string, args: { role: string }) => TelegramBotLike,
  loadDeliveryConfig: () => Promise<NotificationTopicDeliveryConfig>,
  input: {
    topicId: string
    title: string
  },
): Promise<void> {
  const topicId = parseNotificationTopicId(input.topicId)
  const title = input.title.trim()
  if (title.length === 0) {
    throw new ConnectError("Topic title must not be empty", Code.InvalidArgument)
  }

  const topic = await prisma.notificationTopic.findUnique({
    where: {
      id: topicId,
    },
    select: {
      id: true,
      threadEcid: true,
      creatorSubjectId: true,
    },
  })

  if (!topic) {
    throw new ConnectError(`Topic "${input.topicId}" was not found`, Code.NotFound)
  }

  const deliveryConfig = await loadDeliveryConfig()
  const botToken = await resolveTopicBotToken(
    crypto,
    prisma,
    topic.creatorSubjectId,
    deliveryConfig.botToken,
  )
  const bot = createTelegramBotClient(botToken, {
    role: "topic.update",
  })
  if (!bot.api.editForumTopic) {
    throw new ConnectError("Telegram bot client does not support topic update", Code.Internal)
  }

  const thread = await crypto.decrypt(telegramTopicThreadSchema, topic.threadEcid)

  await bot.api.editForumTopic(thread.chat_id, thread.message_thread_id, { name: title })
  await prisma.notificationTopic.update({
    where: {
      id: topic.id,
    },
    data: {
      title,
    },
  })
}

export async function deleteNotificationTopicForReplica(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  createTelegramBotClient: (token: string, args: { role: string }) => TelegramBotLike,
  loadDeliveryConfig: () => Promise<NotificationTopicDeliveryConfig>,
  input: {
    topicId: string
  },
): Promise<void> {
  const topicId = parseNotificationTopicId(input.topicId)
  const topic = await prisma.notificationTopic.findUnique({
    where: {
      id: topicId,
    },
    select: {
      id: true,
      threadEcid: true,
      creatorSubjectId: true,
    },
  })

  if (!topic) {
    throw new ConnectError(`Topic "${input.topicId}" was not found`, Code.NotFound)
  }

  const deliveryConfig = await loadDeliveryConfig()
  const botToken = await resolveTopicBotToken(
    crypto,
    prisma,
    topic.creatorSubjectId,
    deliveryConfig.botToken,
  )
  const bot = createTelegramBotClient(botToken, {
    role: "topic.delete",
  })
  if (!bot.api.deleteForumTopic) {
    throw new ConnectError("Telegram bot client does not support topic deletion", Code.Internal)
  }

  const thread = await crypto.decrypt(telegramTopicThreadSchema, topic.threadEcid)

  await bot.api.deleteForumTopic(thread.chat_id, thread.message_thread_id)
  await prisma.notificationTopic.delete({
    where: {
      id: topic.id,
    },
  })
}

export function parseNotificationTopicId(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConnectError(`Invalid topic id "${value}"`, Code.InvalidArgument)
  }

  return parsed
}

async function resolveTopicBotToken(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  subjectId: string,
  fallbackBotToken: string,
): Promise<string> {
  const avatar = await prisma.avatar.findUnique({
    where: {
      subjectId,
    },
    select: {
      tokenEcid: true,
    },
  })

  if (!avatar) {
    return fallbackBotToken
  }

  return await crypto.decrypt(encryptedStringSchema, avatar.tokenEcid)
}
