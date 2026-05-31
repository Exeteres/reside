import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type { PermissionRequestServiceClient } from "@reside/api/access/request.v1"
import type { DiscoveryServiceClient } from "@reside/api/alpha/discovery.v1"
import type { NaturalLanguageServiceClient } from "@reside/api/interaction/nls.v1"
import type { PrismaClient } from "../../database"
import { strings } from "../../locale"
import { canAskNls, requestNlsAskPermission } from "./authorization"
import { createTelegramBotClient } from "./bot-client"
import { resolveNlsMessageThreadId } from "./bot-command"
import { mapReplicaCallErrorMessage } from "./bot-replica-call"

export async function handleNlsMessage(args: {
  prisma: PrismaClient
  discoveryService: DiscoveryServiceClient
  authzService: AuthzServiceClient
  permissionRequestService: PermissionRequestServiceClient
  getNaturalLanguageClient: (endpoint: string) => NaturalLanguageServiceClient
  createTelegramBotClient?: typeof createTelegramBotClient
  managerToken: string
  chatId: number
  userId: number
  message: {
    message_id: number
    message_thread_id?: number
    reply_to_message?: {
      message_thread_id?: number
    }
  }
  text: string
  mentionedUsername: string | undefined
}): Promise<void> {
  const telegramBotClientFactory = args.createTelegramBotClient ?? createTelegramBotClient
  const messageThreadId = resolveNlsMessageThreadId(args.message)
  const chatId = String(args.chatId)
  const telegramUserId = String(args.userId)

  const interaction =
    args.mentionedUsername !== undefined
      ? await resolveMentionedReplicaInteraction(args.prisma, chatId, telegramUserId, {
          threadId: messageThreadId,
          mentionedUsername: args.mentionedUsername,
        })
      : await args.prisma.naturalLanguageInteraction.findUnique({
          where: {
            chatId_threadId: {
              chatId,
              threadId: messageThreadId,
            },
          },
          select: {
            replicaName: true,
            user: {
              select: {
                telegramId: true,
              },
            },
          },
        })

  if (!interaction) {
    return
  }

  if (interaction.user.telegramId !== telegramUserId) {
    await sendNlsReplyMessage({
      createTelegramBotClient: telegramBotClientFactory,
      managerToken: args.managerToken,
      avatarToken: null,
      chatId: args.chatId,
      replyToMessageId: args.message.message_id,
      text: strings.worker.bot.nlsSessionOwnedByAnotherUser(interaction.replicaName),
    })
    return
  }

  const fromSubjectId = `telegram:${args.userId}`
  const toSubjectId = `replica:${interaction.replicaName}`

  const permission = await canAskNls({
    authzService: args.authzService,
    fromSubjectId,
    toSubjectId,
  })

  if (!permission.authorized) {
    if (permission.checked) {
      await requestNlsAskPermission({
        permissionRequestService: args.permissionRequestService,
        fromSubjectId,
        toSubjectId,
      })
    }

    const botToken = await resolveReplicaAvatarToken(args.prisma, interaction.replicaName)
    await sendNlsReplyMessage({
      createTelegramBotClient: telegramBotClientFactory,
      managerToken: args.managerToken,
      avatarToken: botToken,
      chatId: args.chatId,
      replyToMessageId: args.message.message_id,
      text: strings.common.accessDenied,
    })
    return
  }

  const avatarToken = await resolveReplicaAvatarToken(args.prisma, interaction.replicaName)

  await setNlsInProgressReaction({
    createTelegramBotClient: telegramBotClientFactory,
    managerToken: args.managerToken,
    avatarToken,
    chatId: args.chatId,
    messageId: args.message.message_id,
  })

  try {
    const endpoint = await args.discoveryService.getSubjectEndpoint({
      subjectId: toSubjectId,
    })

    const nlsResponse = await args.getNaturalLanguageClient(endpoint.endpoint).ask({
      text: args.text,
      subjectId: fromSubjectId,
    })

    await sendNlsReplyMessage({
      createTelegramBotClient: telegramBotClientFactory,
      managerToken: args.managerToken,
      avatarToken,
      chatId: args.chatId,
      replyToMessageId: args.message.message_id,
      text: nlsResponse.text,
    })
  } catch (error) {
    const mappedMessage = mapReplicaCallErrorMessage(error, {
      deadMessage: strings.worker.bot.nlsReplicaUnavailable,
      brokenMessage: strings.worker.bot.nlsReplicaBroken,
    })

    await sendNlsReplyMessage({
      createTelegramBotClient: telegramBotClientFactory,
      managerToken: args.managerToken,
      avatarToken,
      chatId: args.chatId,
      replyToMessageId: args.message.message_id,
      text: mappedMessage,
    })
  }
}

async function resolveMentionedReplicaInteraction(
  prisma: PrismaClient,
  chatId: string,
  telegramUserId: string,
  input: {
    threadId: number
    mentionedUsername: string
  },
): Promise<{
  replicaName: string
  user: {
    telegramId: string
  }
} | null> {
  const avatar = await prisma.avatar.findFirst({
    where: {
      managedBotUsername: {
        equals: input.mentionedUsername,
        mode: "insensitive",
      },
    },
    select: {
      replicaName: true,
    },
  })

  if (!avatar) {
    return null
  }

  const owner = await prisma.user.findUnique({
    where: {
      telegramId: telegramUserId,
    },
    select: {
      id: true,
      telegramId: true,
    },
  })

  if (!owner) {
    return null
  }

  await prisma.naturalLanguageInteraction.upsert({
    where: {
      chatId_threadId: {
        chatId,
        threadId: input.threadId,
      },
    },
    create: {
      chatId,
      userId: owner.id,
      threadId: input.threadId,
      replicaName: avatar.replicaName,
    },
    update: {
      userId: owner.id,
      replicaName: avatar.replicaName,
    },
    select: {
      id: true,
    },
  })

  return {
    replicaName: avatar.replicaName,
    user: {
      telegramId: owner.telegramId,
    },
  }
}

async function resolveReplicaAvatarToken(
  prisma: PrismaClient,
  replicaName: string,
): Promise<string | null> {
  const avatar = await prisma.avatar.findUnique({
    where: {
      replicaName,
    },
    select: {
      token: true,
    },
  })

  return avatar?.token ?? null
}

async function setNlsInProgressReaction(args: {
  createTelegramBotClient: typeof createTelegramBotClient
  managerToken: string
  avatarToken: string | null
  chatId: number
  messageId: number
}): Promise<void> {
  const reactionBot = args.createTelegramBotClient(args.avatarToken ?? args.managerToken, {
    role: "worker.nls-reaction",
  })

  await reactionBot.api.setMessageReaction(args.chatId, args.messageId, [
    {
      type: "emoji",
      emoji: "👀",
    },
  ])
}

async function sendNlsReplyMessage(args: {
  createTelegramBotClient: typeof createTelegramBotClient
  managerToken: string
  avatarToken: string | null
  chatId: number
  replyToMessageId: number
  text: string
}): Promise<void> {
  const replyBot = args.createTelegramBotClient(args.avatarToken ?? args.managerToken, {
    role: "worker.nls-reply",
  })

  await replyBot.api.sendMessage(args.chatId, args.text, {
    parse_mode: "HTML",
    link_preview_options: {
      is_disabled: true,
    },
    reply_parameters: {
      message_id: args.replyToMessageId,
    },
  })
}
