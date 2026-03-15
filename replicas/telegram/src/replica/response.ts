import type { GenericOperationService } from "@reside/common"
import type { Operation, PrismaClient } from "../database"
import { logger } from "@reside/common"
import { isRecord } from "@reside/utils"

type TelegramOperationService = GenericOperationService<Operation>

export type CallbackCompletionResult =
  | { accepted: true; unauthorized: false; reason: "accepted" }
  | {
      accepted: false
      unauthorized: boolean
      reason: "not-found" | "chat-not-authorized" | "already-responded" | "action-not-allowed"
    }

export async function completeOperationFromTextReply(args: {
  prisma: PrismaClient
  operationService: TelegramOperationService
  chatId: number
  userId: number
  repliedMessageId: number
  textResponse: string
  canInteractWithChannel: (userId: number, channelName: string | null) => Promise<boolean>
  isSuperAdminUser: (userId: number) => boolean
}): Promise<{ completed: boolean; unauthorized: boolean }> {
  const operations = await getPendingOperationsByMessage(args.prisma, {
    messageId: args.repliedMessageId,
  })

  const operation = operations.find(
    candidate => candidate.response === null && isChatAuthorized(candidate.context, args.chatId),
  )

  if (!operation) {
    return { completed: false, unauthorized: false }
  }

  if (
    operation.isProtected &&
    !args.isSuperAdminUser(args.userId) &&
    !(await args.canInteractWithChannel(args.userId, operation.channelName))
  ) {
    return { completed: false, unauthorized: true }
  }

  try {
    await args.prisma.notificationResponse.create({
      data: {
        operationId: operation.id,
        type: "TEXT",
        actionName: null,
        textResponse: args.textResponse,
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

export async function completeOperationFromCallbackAction(args: {
  prisma: PrismaClient
  operationService: TelegramOperationService
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
    isChatAuthorized(candidate.context, args.chatId),
  )

  const actionableOperation = chatAuthorizedOperations.find(
    candidate => candidate.response === null && candidate.allowedActions.includes(args.actionName),
  )

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
        candidate.response === null && !candidate.allowedActions.includes(args.actionName),
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
    return { accepted: false, unauthorized: true, reason: "chat-not-authorized" }
  }

  try {
    await args.prisma.notificationResponse.create({
      data: {
        operationId: actionableOperation.id,
        type: "ACTION",
        actionName: args.actionName,
        textResponse: null,
      },
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      if (await hasExistingResponseForPendingOperation(args.prisma, actionableOperation.id)) {
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
  Array<{
    id: number
    allowedActions: string[]
    channelName: string | null
    isProtected: boolean
    context: {
      chatTelegramId: string | null
      userTelegramId: string | null
    }
    response: { operationId: number } | null
  }>
> {
  const records = await prisma.notification.findMany({
    where: {
      messageId: args.messageId,
      operation: {
        status: "PENDING",
      },
    },
    select: {
      id: true,
      allowedActions: true,
      isProtected: true,
      channel: {
        select: {
          name: true,
        },
      },
      context: {
        select: {
          chat: {
            select: {
              telegramId: true,
            },
          },
          user: {
            select: {
              telegramId: true,
            },
          },
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
        allowedActions: record.allowedActions,
        channelName: record.channel.name,
        isProtected: record.isProtected,
        context: {
          chatTelegramId: record.context.chat?.telegramId ?? null,
          userTelegramId: record.context.user?.telegramId ?? null,
        },
        response: record.operation.notificationResponse,
      },
    ]
  })
}

function isChatAuthorized(
  context: { chatTelegramId: string | null; userTelegramId: string | null },
  chatId: number,
): boolean {
  if (!context.chatTelegramId) {
    return true
  }

  return context.chatTelegramId === String(chatId)
}

async function findRespondedOperationByMessage(
  prisma: PrismaClient,
  args: { messageId: number; chatId: number },
): Promise<{ id: number } | null> {
  const notification = await prisma.notification.findFirst({
    where: {
      messageId: args.messageId,
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
      context: {
        select: {
          chat: {
            select: {
              telegramId: true,
            },
          },
          user: {
            select: {
              telegramId: true,
            },
          },
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

  if (
    !isChatAuthorized(
      {
        chatTelegramId: notification.context.chat?.telegramId ?? null,
        userTelegramId: notification.context.user?.telegramId ?? null,
      },
      args.chatId,
    )
  ) {
    return null
  }

  return {
    id: notification.operation.id,
  }
}
