import type { GenericOperationService } from "@reside/common"
import type { ResideCrypto } from "@reside/common/encryption"
import type { Operation, PrismaClient } from "../../database"
import { logger, rhid } from "@reside/common"
import { isRecord } from "@reside/utils"
import { createInteractionContextToken } from "../../shared"
import { getNotificationCallbackActionNames } from "./notification-pagination"

export type CallbackCompletionReason =
  | "accepted"
  | "not-found"
  | "chat-not-authorized"
  | "already-responded"
  | "action-not-allowed"

type RejectedCallbackCompletionReason = Exclude<CallbackCompletionReason, "accepted">
type AcceptedCallbackCompletionReason = Extract<CallbackCompletionReason, "accepted">

export type CallbackCompletionResult =
  | { accepted: true; unauthorized: false; reason: AcceptedCallbackCompletionReason }
  | {
      accepted: false
      unauthorized: boolean
      reason: RejectedCallbackCompletionReason
      unauthorizedChannelName?: string | null
    }

export async function completeOperationFromTextReply(args: {
  crypto: ResideCrypto
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
  chatId: number
  userId: number
  repliedMessageId: number
  responseMessageId: number
  textResponse: string
  canInteractWithChannel: (userId: number, channelName: string | null) => Promise<boolean>
  isSuperAdminUser: (userId: number) => boolean
}): Promise<{
  completed: boolean
  unauthorized: boolean
  unauthorizedChannelName?: string | null
}> {
  const operations = await getPendingOperationsByMessage(args.prisma, {
    messageId: args.repliedMessageId,
  })

  const operation = operations.find(
    candidate =>
      candidate.response === null && isChatAuthorized(candidate.targetChatRhid, args.chatId),
  )

  if (!operation) {
    return { completed: false, unauthorized: false }
  }

  if (
    operation.isProtected &&
    !args.isSuperAdminUser(args.userId) &&
    !(await args.canInteractWithChannel(args.userId, operation.channelName))
  ) {
    return {
      completed: false,
      unauthorized: true,
      unauthorizedChannelName: operation.channelName,
    }
  }

  try {
    const responseContextToken = await createInteractionContextToken(args.crypto, {
      chat_id: String(args.chatId),
      message_id: args.responseMessageId,
    })

    await args.prisma.notificationResponse.create({
      data: {
        operationId: operation.id,
        type: "TEXT",
        actionName: null,
        textResponseEcid: await args.crypto.encrypt(args.textResponse),
      },
    })

    await args.prisma.operation.update({
      where: {
        id: operation.id,
      },
      data: {
        notificationResponseContextToken: responseContextToken,
      },
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      if (await hasExistingResponseForPendingOperation(args.prisma, operation.id)) {
        await args.operationService.setCompleted(operation.id)
        return { completed: true, unauthorized: false }
      }

      return { completed: false, unauthorized: false }
    }

    throw error
  }

  await args.operationService.setCompleted(operation.id)

  logger.info({ operationId: operation.id }, "notification text response persisted")

  return { completed: true, unauthorized: false }
}

export async function completeOperationFromTopicMessage(args: {
  crypto: ResideCrypto
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
  chatId: number
  userId: number
  messageThreadId: number | undefined
  responseMessageId: number
  textResponse: string
  canInteractWithChannel: (userId: number, channelName: string | null) => Promise<boolean>
  isSuperAdminUser: (userId: number) => boolean
}): Promise<{
  completed: boolean
  unauthorized: boolean
  unauthorizedChannelName?: string | null
}> {
  if (args.messageThreadId === undefined) {
    return { completed: false, unauthorized: false }
  }

  const operation = await getPendingOperationByTopic(args.prisma, {
    chatId: args.chatId,
    messageThreadId: args.messageThreadId,
  })

  if (!operation) {
    return { completed: false, unauthorized: false }
  }

  if (
    operation.isProtected &&
    !args.isSuperAdminUser(args.userId) &&
    !(await args.canInteractWithChannel(args.userId, operation.channelName))
  ) {
    return {
      completed: false,
      unauthorized: true,
      unauthorizedChannelName: operation.channelName,
    }
  }

  try {
    const responseContextToken = await createInteractionContextToken(args.crypto, {
      chat_id: String(args.chatId),
      message_id: args.responseMessageId,
    })

    await args.prisma.notificationResponse.create({
      data: {
        operationId: operation.id,
        type: "TEXT",
        actionName: null,
        textResponseEcid: await args.crypto.encrypt(args.textResponse),
      },
    })

    await args.prisma.operation.update({
      where: {
        id: operation.id,
      },
      data: {
        notificationResponseContextToken: responseContextToken,
      },
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      if (await hasExistingResponseForPendingOperation(args.prisma, operation.id)) {
        await args.operationService.setCompleted(operation.id)
        return { completed: true, unauthorized: false }
      }

      return { completed: false, unauthorized: false }
    }

    throw error
  }

  await args.operationService.setCompleted(operation.id)

  logger.info({ operationId: operation.id }, "notification topic response persisted")

  return { completed: true, unauthorized: false }
}

export async function completeOperationFromCallbackAction(args: {
  crypto: ResideCrypto
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
  chatId: number
  userId: number
  messageId: number
  actionName: string
  canInteractWithChannel: (userId: number, channelName: string | null) => Promise<boolean>
  isSuperAdminUser: (userId: number) => boolean
}): Promise<CallbackCompletionResult> {
  const operations = await getPendingOperationsByMessage(args.prisma, {
    messageId: args.messageId,
  })

  const chatAuthorizedOperations = operations.filter(candidate =>
    isChatAuthorized(candidate.targetChatRhid, args.chatId),
  )

  logger.debug(
    {
      chatId: args.chatId,
      messageId: args.messageId,
      actionName: args.actionName,
      pendingOperations: operations.length,
      chatAuthorizedOperations: chatAuthorizedOperations.length,
    },
    "evaluating callback action",
  )

  const actionableOperation = chatAuthorizedOperations.find(
    candidate =>
      candidate.response === null && candidate.callbackActionNames.includes(args.actionName),
  )

  if (actionableOperation) {
    logger.info(
      {
        operationId: actionableOperation.id,
        chatId: args.chatId,
        messageId: args.messageId,
        actionName: args.actionName,
        callbackActionNames: actionableOperation.callbackActionNames,
      },
      "selected pending operation for callback action",
    )
  }

  if (!actionableOperation) {
    const respondedOperation = chatAuthorizedOperations.find(
      candidate => candidate.response !== null,
    )
    if (respondedOperation) {
      logger.debug(
        {
          operationId: respondedOperation.id,
          chatId: args.chatId,
          messageId: args.messageId,
          actionName: args.actionName,
        },
        "ignoring callback action because operation was already responded",
      )

      return { accepted: false, unauthorized: false, reason: "already-responded" }
    }

    const actionNotAllowedOperation = chatAuthorizedOperations.find(
      candidate =>
        candidate.response === null && !candidate.callbackActionNames.includes(args.actionName),
    )
    if (actionNotAllowedOperation) {
      logger.warn(
        {
          operationId: actionNotAllowedOperation.id,
          actionName: args.actionName,
        },
        "notification callback action is not allowed",
      )

      return { accepted: false, unauthorized: false, reason: "action-not-allowed" }
    }

    if (operations.length > 0) {
      logger.debug(
        {
          chatId: args.chatId,
          messageId: args.messageId,
          actionName: args.actionName,
        },
        "ignoring callback action because chat is not authorized for notification",
      )

      return { accepted: false, unauthorized: false, reason: "chat-not-authorized" }
    }

    const alreadyResponded = await findRespondedOperationByMessage(args.prisma, {
      messageId: args.messageId,
      chatId: args.chatId,
    })
    if (alreadyResponded) {
      logger.debug(
        {
          operationId: alreadyResponded.id,
          chatId: args.chatId,
          messageId: args.messageId,
          actionName: args.actionName,
        },
        "ignoring callback action because operation was already responded",
      )

      return { accepted: false, unauthorized: false, reason: "already-responded" }
    }

    return { accepted: false, unauthorized: false, reason: "not-found" }
  }

  if (
    actionableOperation.isProtected &&
    !args.isSuperAdminUser(args.userId) &&
    !(await args.canInteractWithChannel(args.userId, actionableOperation.channelName))
  ) {
    logger.info(
      {
        operationId: actionableOperation.id,
        chatId: args.chatId,
        userId: args.userId,
        channelName: actionableOperation.channelName,
      },
      "rejecting callback action due to channel permission check",
    )

    return {
      accepted: false,
      unauthorized: true,
      reason: "chat-not-authorized",
      unauthorizedChannelName: actionableOperation.channelName,
    }
  }

  try {
    await args.prisma.notificationResponse.create({
      data: {
        operationId: actionableOperation.id,
        type: "ACTION",
        actionName: args.actionName,
        textResponseEcid: null,
      },
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      logger.warn(
        {
          operationId: actionableOperation.id,
          actionName: args.actionName,
        },
        "notification callback response hit unique constraint",
      )

      if (await hasExistingResponseForPendingOperation(args.prisma, actionableOperation.id)) {
        logger.info(
          {
            operationId: actionableOperation.id,
            actionName: args.actionName,
          },
          "completing operation after duplicate callback response",
        )

        await args.operationService.setCompleted(actionableOperation.id)
        return { accepted: true, unauthorized: false, reason: "accepted" }
      }

      return { accepted: false, unauthorized: false, reason: "already-responded" }
    }

    throw error
  }

  await args.operationService.setCompleted(actionableOperation.id)

  logger.info(
    {
      operationId: actionableOperation.id,
      actionName: args.actionName,
    },
    "notification callback response persisted",
  )

  return { accepted: true, unauthorized: false, reason: "accepted" }
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false
  }

  return error.code === "P2002"
}

async function hasExistingResponseForPendingOperation(
  prisma: PrismaClient,
  operationId: number,
): Promise<boolean> {
  const operation = await prisma.operation.findUnique({
    where: {
      id: operationId,
    },
    select: {
      status: true,
      notificationResponse: {
        select: {
          operationId: true,
        },
      },
    },
  })

  if (operation === null) {
    return false
  }

  return operation.status === "PENDING" && operation.notificationResponse !== null
}

async function getPendingOperationsByMessage(
  prisma: PrismaClient,
  args: { messageId: number },
): Promise<
  {
    id: number
    callbackActionNames: string[]
    channelName: string | null
    isProtected: boolean
    targetChatRhid: string
    response: { operationId: number } | null
  }[]
> {
  const records = await prisma.notification.findMany({
    where: {
      messageRhid: rhid(args.messageId),
      operation: {
        status: "PENDING",
      },
    },
    select: {
      id: true,
      actionRows: true,
      isProtected: true,
      channel: {
        select: {
          name: true,
        },
      },
      chat: {
        select: {
          telegramRhid: true,
        },
      },
      operation: {
        select: {
          id: true,
          notificationResponse: {
            select: {
              operationId: true,
            },
          },
        },
      },
    },
    orderBy: {
      id: "desc",
    },
  })

  return records.flatMap(record => {
    if (record.operation === null) {
      return []
    }

    return [
      {
        id: record.operation.id,
        callbackActionNames: getNotificationCallbackActionNames(record.actionRows),
        channelName: record.channel.name,
        isProtected: record.isProtected,
        targetChatRhid: record.chat.telegramRhid,
        response: record.operation.notificationResponse,
      },
    ]
  })
}

async function getPendingOperationByTopic(
  prisma: PrismaClient,
  args: { chatId: number; messageThreadId: number },
): Promise<{
  id: number
  channelName: string | null
  isProtected: boolean
} | null> {
  const record = await prisma.notification.findFirst({
    where: {
      acquireTopic: true,
      topic: {
        threadRhid: rhid(args.messageThreadId),
        chat: {
          telegramRhid: rhid(String(args.chatId)),
        },
      },
      operation: {
        status: "PENDING",
        notificationResponse: null,
      },
    },
    select: {
      isProtected: true,
      channel: {
        select: {
          name: true,
        },
      },
      operation: {
        select: {
          id: true,
        },
      },
    },
    orderBy: {
      id: "desc",
    },
  })

  if (!record?.operation) {
    return null
  }

  return {
    id: record.operation.id,
    channelName: record.channel.name,
    isProtected: record.isProtected,
  }
}

function isChatAuthorized(targetChatRhid: string, chatId: number): boolean {
  return targetChatRhid === rhid(String(chatId))
}

async function findRespondedOperationByMessage(
  prisma: PrismaClient,
  args: { messageId: number; chatId: number },
): Promise<{ id: number } | null> {
  const notification = await prisma.notification.findFirst({
    where: {
      messageRhid: rhid(args.messageId),
      operation: {
        notificationResponse: {
          isNot: null,
        },
      },
    },
    select: {
      operation: {
        select: {
          id: true,
        },
      },
      chat: {
        select: {
          telegramRhid: true,
        },
      },
    },
    orderBy: {
      id: "desc",
    },
  })

  if (!notification?.operation) {
    return null
  }

  if (!isChatAuthorized(notification.chat.telegramRhid, args.chatId)) {
    return null
  }

  return {
    id: notification.operation.id,
  }
}
