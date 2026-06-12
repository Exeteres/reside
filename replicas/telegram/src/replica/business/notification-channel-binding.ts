import type { ResideCrypto } from "@reside/common/encryption"
import type { PrismaClient } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"
import { rhid } from "@reside/common"
import { telegramChatDataSchema, telegramTopicThreadSchema } from "../../definitions"
import { strings } from "../../locale"
import { parseNotificationTopicId } from "./notification-topic"

const TELEGRAM_REPLICA_SUBJECT_ID = "replica:telegram"

export type NotificationChannelRoute = {
  chatId: string
  messageThreadId: number | undefined
  topicId: number | undefined
}

export async function bindNotificationChannel(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  input: {
    channelName: string
    chatId: number
    topic?: BindingTopicInfo
  },
): Promise<{ bindingId: number; channelTitle: string; topicTitle: string | undefined }> {
  const channelName = normalizeChannelName(input.channelName)
  const channel = await prisma.notificationChannel.findUnique({
    where: {
      name: channelName,
    },
    select: {
      id: true,
      title: true,
    },
  })

  if (!channel) {
    throw new ConnectError(`Channel with name "${channelName}" was not found`, Code.NotFound)
  }

  const topic =
    input.topic === undefined
      ? null
      : await resolveBindingTopic(crypto, prisma, channel.id, input.chatId, input.topic)

  const binding = await prisma.notificationChannelBinding.upsert({
    where: {
      channelId: channel.id,
    },
    create: {
      channelId: channel.id,
      chatId: input.chatId,
      topicId: topic?.id ?? null,
    },
    update: {
      chatId: input.chatId,
      topicId: topic?.id ?? null,
    },
    select: {
      id: true,
    },
  })

  return {
    bindingId: binding.id,
    channelTitle: channel.title,
    topicTitle: topic?.title,
  }
}

export type BindingTopicInfo = {
  chatId: string
  messageThreadId: number
  title?: string
}

export async function deleteNotificationChannelBinding(
  prisma: PrismaClient,
  channelNameValue: string,
): Promise<{ deleted: boolean; channelTitle: string }> {
  const channelName = normalizeChannelName(channelNameValue)
  const channel = await prisma.notificationChannel.findUnique({
    where: {
      name: channelName,
    },
    select: {
      id: true,
      title: true,
    },
  })

  if (!channel) {
    throw new ConnectError(`Channel with name "${channelName}" was not found`, Code.NotFound)
  }

  const result = await prisma.notificationChannelBinding.deleteMany({
    where: {
      channelId: channel.id,
    },
  })

  return {
    deleted: result.count > 0,
    channelTitle: channel.title,
  }
}

export async function resolveNotificationChannelRoute(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  input: {
    channelId: number
    channelName: string
    requestedTopicId?: string
    systemChatId: string
  },
): Promise<NotificationChannelRoute> {
  const binding = await prisma.notificationChannelBinding.findUnique({
    where: {
      channelId: input.channelId,
    },
    select: {
      topicId: true,
      chat: {
        select: {
          dataEcid: true,
        },
      },
      topic: {
        select: {
          id: true,
          threadEcid: true,
        },
      },
    },
  })

  if (binding?.topicId !== null && binding?.topicId !== undefined) {
    if (input.requestedTopicId !== undefined && input.requestedTopicId.trim().length > 0) {
      throw new ConnectError(
        `Channel "${input.channelName}" is already routed to topic "${binding.topicId}"`,
        Code.InvalidArgument,
      )
    }

    if (!binding.topic) {
      throw new ConnectError(
        `Channel "${input.channelName}" binding references missing topic "${binding.topicId}"`,
        Code.FailedPrecondition,
      )
    }

    const thread = await crypto.decrypt(telegramTopicThreadSchema, binding.topic.threadEcid)

    return {
      chatId: thread.chat_id,
      messageThreadId: thread.message_thread_id,
      topicId: binding.topic.id,
    }
  }

  if (input.requestedTopicId !== undefined && input.requestedTopicId.trim().length > 0) {
    const topic = await resolveNotificationTopicRoute(crypto, prisma, input.requestedTopicId)

    return topic
  }

  if (binding) {
    const chatData = await crypto.decrypt(telegramChatDataSchema, binding.chat.dataEcid)

    return {
      chatId: String(chatData.id),
      messageThreadId: undefined,
      topicId: undefined,
    }
  }

  return {
    chatId: input.systemChatId,
    messageThreadId: undefined,
    topicId: undefined,
  }
}

async function resolveBindingTopic(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  channelId: number,
  chatId: number,
  input: BindingTopicInfo,
): Promise<{ id: number; title: string }> {
  const topic = await prisma.notificationTopic.findUnique({
    where: {
      chatId_threadRhid: {
        chatId,
        threadRhid: rhid(input.messageThreadId),
      },
    },
    select: {
      id: true,
      chatId: true,
      channelId: true,
      title: true,
    },
  })

  if (!topic) {
    const title = toBindingTopicTitle(input)
    const threadEcid = await crypto.encrypt({
      chat_id: input.chatId,
      message_thread_id: input.messageThreadId,
    })
    const createdTopic = await prisma.notificationTopic.create({
      data: {
        chatId,
        channelId,
        threadRhid: rhid(input.messageThreadId),
        threadEcid,
        creatorSubjectId: TELEGRAM_REPLICA_SUBJECT_ID,
        title,
      },
      select: {
        id: true,
        title: true,
      },
    })

    return {
      id: createdTopic.id,
      title: createdTopic.title,
    }
  }

  if (topic.channelId !== channelId) {
    throw new ConnectError(
      "Current topic belongs to another notification channel",
      Code.InvalidArgument,
    )
  }

  return {
    id: topic.id,
    title: topic.title,
  }
}

function toBindingTopicTitle(input: BindingTopicInfo): string {
  const title = input.title?.trim()
  if (title !== undefined && title.length > 0) {
    return title
  }

  return strings.worker.bot.notificationChannelBinding.topicFallbackTitle(input.messageThreadId)
}

async function resolveNotificationTopicRoute(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  topicIdValue: string,
): Promise<NotificationChannelRoute> {
  const topicId = parseNotificationTopicId(topicIdValue)
  const topic = await prisma.notificationTopic.findUnique({
    where: {
      id: topicId,
    },
    select: {
      id: true,
      threadEcid: true,
    },
  })

  if (!topic) {
    throw new ConnectError(`Topic "${topicIdValue}" was not found`, Code.NotFound)
  }

  const thread = await crypto.decrypt(telegramTopicThreadSchema, topic.threadEcid)

  return {
    chatId: thread.chat_id,
    messageThreadId: thread.message_thread_id,
    topicId: topic.id,
  }
}

function normalizeChannelName(channelNameValue: string): string {
  const channelName = channelNameValue.trim()
  if (channelName.length === 0) {
    throw new ConnectError("Channel name must not be empty", Code.InvalidArgument)
  }

  return channelName
}
