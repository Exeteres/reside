import type { InlineKeyboardMarkup, InputMediaPhoto } from "grammy/types"
import type { PrismaClient } from "../../database"
import type { TelegramBotLike } from "./notification-types"
import { Code, ConnectError } from "@connectrpc/connect"
import { block, bold, logger } from "@reside/common"
import { InputFile } from "grammy"
import { TelegramNotificationChannels } from "../../definitions"
import { strings } from "../../locale"
import { isReplyTargetMessageMissingError, toReplyParameters } from "./notification-message"

export async function sendNotificationPayload(
  bot: TelegramBotLike,
  chatId: string,
  request: {
    images: Array<{ content: Uint8Array; name: string }>
    attachments: Array<{ content: Uint8Array; name: string }>
  },
  messageText: string,
  replyMarkup: InlineKeyboardMarkup | undefined,
  replyToMessageId: number | undefined,
): Promise<number> {
  if (request.images.length === 0) {
    const sentMessage = await bot.api.sendMessage(chatId, messageText, {
      parse_mode: "HTML",
      link_preview_options: {
        is_disabled: true,
      },
      reply_markup: replyMarkup,
      reply_parameters: toReplyParameters(replyToMessageId),
    })

    if (request.attachments.length > 0) {
      await sendAttachmentGroup(bot, chatId, request.attachments, replyToMessageId)
    }

    return sentMessage.message_id
  }

  const imageMessages = await sendImageGroup(
    bot,
    chatId,
    request.images,
    messageText,
    replyToMessageId,
  )
  const firstImageMessage = imageMessages[0]

  if (!firstImageMessage) {
    throw new ConnectError("Failed to send image group", Code.Internal)
  }

  if (request.attachments.length > 0) {
    await sendAttachmentGroup(bot, chatId, request.attachments, replyToMessageId)
  }

  if (!replyMarkup) {
    return firstImageMessage.message_id
  }

  const actionMessage = await bot.api.sendMessage(
    chatId,
    strings.server.notification.chooseAction,
    {
      link_preview_options: {
        is_disabled: true,
      },
      reply_markup: replyMarkup,
      reply_parameters: toReplyParameters(replyToMessageId),
    },
  )

  return actionMessage.message_id
}

async function sendImageGroup(
  bot: TelegramBotLike,
  chatId: string,
  images: Array<{ content: Uint8Array; name: string }>,
  caption?: string,
  replyToMessageId?: number,
): Promise<{ message_id: number }[]> {
  if (images.length === 1) {
    const [image] = images
    if (!image) {
      return []
    }

    const imageFile = new InputFile(Buffer.from(image.content), image.name)
    const sentMessage = await bot.api.sendPhoto(chatId, imageFile, {
      caption,
      parse_mode: caption ? "HTML" : undefined,
      show_caption_above_media: caption ? true : undefined,
      reply_parameters: toReplyParameters(replyToMessageId),
    })

    return [sentMessage]
  }

  const mediaGroup: InputMediaPhoto[] = images.map((image, index) => ({
    type: "photo" as const,
    media: new InputFile(Buffer.from(image.content), image.name),
    caption: index === 0 ? caption : undefined,
    parse_mode: index === 0 && caption ? ("HTML" as const) : undefined,
    show_caption_above_media: index === 0 && caption ? true : undefined,
  }))

  return await bot.api.sendMediaGroup(chatId, mediaGroup, {
    reply_parameters: toReplyParameters(replyToMessageId),
  })
}

async function sendAttachmentGroup(
  bot: TelegramBotLike,
  chatId: string,
  attachments: Array<{ content: Uint8Array; name: string }>,
  replyToMessageId?: number,
): Promise<void> {
  if (attachments.length === 1) {
    const [attachment] = attachments
    if (!attachment) {
      return
    }

    const attachmentFile = new InputFile(Buffer.from(attachment.content), attachment.name)
    await bot.api.sendDocument(chatId, attachmentFile, {
      reply_parameters: toReplyParameters(replyToMessageId),
    })
    return
  }

  const mediaGroup = attachments.map(attachment => ({
    type: "document" as const,
    media: new InputFile(Buffer.from(attachment.content), attachment.name),
  }))

  await bot.api.sendMediaGroup(chatId, mediaGroup, {
    reply_parameters: toReplyParameters(replyToMessageId),
  })
}

export async function sendNotificationWithReplyFallback(
  bot: TelegramBotLike,
  targetChatId: string,
  senderSubjectId: string,
  request: {
    images: Array<{ content: Uint8Array; name: string }>
    attachments: Array<{ content: Uint8Array; name: string }>
  },
  messageText: string,
  replyMarkup: InlineKeyboardMarkup | undefined,
  replyToMessageId: number | undefined,
): Promise<{ sentMessageId: number; usedReplyFallback: boolean }> {
  try {
    const sentMessageId = await sendNotificationPayload(
      bot,
      targetChatId,
      request,
      messageText,
      replyMarkup,
      replyToMessageId,
    )

    return {
      sentMessageId,
      usedReplyFallback: false,
    }
  } catch (error) {
    if (replyToMessageId === undefined || !isReplyTargetMessageMissingError(error)) {
      throw error
    }

    logger.warn(
      {
        targetChatId,
        replyToMessageId,
        senderSubjectId,
      },
      "avatar bot reply target message was not found, retrying without reply target",
    )

    const sentMessageId = await sendNotificationPayload(
      bot,
      targetChatId,
      request,
      messageText,
      replyMarkup,
      undefined,
    )

    return {
      sentMessageId,
      usedReplyFallback: true,
    }
  }
}

export async function sendAvatarPrivacyModeWarning(
  prisma: PrismaClient,
  createTelegramBotClient: (token: string, args: { role: string }) => TelegramBotLike,
  botToken: string,
  targetChatId: string,
  callingSubjectId: string,
  sendAsSubjectId: string,
): Promise<void> {
  const warningChannel = await prisma.notificationChannel.findUnique({
    where: {
      name: TelegramNotificationChannels.AVATAR_PRIVACY_MODE,
    },
    select: {
      id: true,
    },
  })

  if (warningChannel === null) {
    logger.warn(
      "privacy-mode warning channel is missing, skipping avatar privacy-mode warning notification",
    )
    return
  }

  const avatar = await prisma.avatar.findUnique({
    where: {
      subjectId: sendAsSubjectId,
    },
    select: {
      managedBotUsername: true,
    },
  })

  const normalizedBotUsername = avatar?.managedBotUsername?.trim()
  const privacyModeWarningContent =
    normalizedBotUsername && normalizedBotUsername.length > 0
      ? strings.server.notification.avatarPrivacyModeWarningContent(normalizedBotUsername)
      : strings.server.notification.avatarPrivacyModeWarningContent("bot_username")

  const warningText = block(
    bold(strings.server.notification.avatarPrivacyModeWarningTitle),
    "",
    privacyModeWarningContent,
  ).html

  const warningBot = createTelegramBotClient(botToken, {
    role: "notification.privacy-mode-warning",
  })

  const warningMessage = await warningBot.api.sendMessage(targetChatId, warningText, {
    parse_mode: "HTML",
    link_preview_options: {
      is_disabled: true,
    },
  })

  await prisma.notification.create({
    data: {
      operationId: null,
      targetChatId,
      replyToMessageId: null,
      channelId: warningChannel.id,
      messageId: warningMessage.message_id,
      callingSubjectId,
      sendAsSubjectId,
      title: strings.server.notification.avatarPrivacyModeWarningTitle,
      content: privacyModeWarningContent,
      actionRows: [],
      requiresTextResponse: false,
      isProtected: false,
    },
  })
}
