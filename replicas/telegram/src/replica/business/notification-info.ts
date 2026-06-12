import type { PrismaClient } from "../../database"
import type { SubjectServiceClientLike } from "./notification-types"
import { block, bold, rhid } from "@reside/common"
import { strings } from "../../locale"
import { resolveSenderDisplayTitle } from "./notification-access"

export type RepliedNotificationInfo = {
  channel: {
    name: string
    title: string
    description?: string
  }
  sender?: {
    subjectId: string
    title: string
  }
}

export async function resolveRepliedNotificationInfo(
  prisma: PrismaClient,
  subjectService: SubjectServiceClientLike,
  chatId: number,
  messageId: number,
): Promise<RepliedNotificationInfo | null> {
  const notification = await prisma.notification.findFirst({
    where: {
      messageRhid: rhid(messageId),
      chat: {
        telegramRhid: rhid(String(chatId)),
      },
    },
    select: {
      sendAsSubjectId: true,
      callingSubjectId: true,
      channel: {
        select: {
          name: true,
          title: true,
          description: true,
        },
      },
    },
    orderBy: {
      id: "desc",
    },
  })

  if (notification === null) {
    return null
  }

  const senderSubjectId = notification.sendAsSubjectId ?? notification.callingSubjectId
  const sender =
    senderSubjectId === null
      ? undefined
      : {
          subjectId: senderSubjectId,
          title: await resolveSenderDisplayTitle(subjectService, senderSubjectId, senderSubjectId),
        }

  return {
    channel: {
      name: notification.channel.name,
      title: notification.channel.title,
      description: notification.channel.description ?? undefined,
    },
    sender,
  }
}

export function renderRepliedNotificationInfo(info: RepliedNotificationInfo): string {
  const rows = [
    bold(strings.worker.bot.notificationInfo.title),
    "",
    bold(strings.worker.bot.notificationInfo.channelSection),
    strings.worker.bot.notificationInfo.channelTitle(info.channel.title),
    strings.worker.bot.notificationInfo.channelName(info.channel.name),
  ]

  if (info.channel.description !== undefined && info.channel.description.length > 0) {
    rows.push(strings.worker.bot.notificationInfo.channelDescription(info.channel.description))
  }

  rows.push("", bold(strings.worker.bot.notificationInfo.senderSection))

  if (info.sender === undefined) {
    rows.push(strings.worker.bot.notificationInfo.senderUnknown)
  } else {
    rows.push(
      strings.worker.bot.notificationInfo.senderTitle(info.sender.title),
      strings.worker.bot.notificationInfo.senderSubjectId(info.sender.subjectId),
    )
  }

  return block(rows).html
}
