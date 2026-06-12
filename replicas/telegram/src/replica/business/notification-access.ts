import type { ResideCrypto } from "@reside/common/encryption"
import type { PrismaClient } from "../../database"
import type { AuthzServiceClientLike, SubjectServiceClientLike } from "./notification-types"
import { Code, ConnectError } from "@connectrpc/connect"
import { logger, rhid } from "@reside/common"
import { WellKnownPermissions } from "@reside/registry"
import { decryptInteractionContextToken } from "../../shared"

export async function resolveSenderSubjectId(
  authzService: AuthzServiceClientLike,
  callerSubjectId: string,
  requestedSubjectId: string | undefined,
): Promise<string> {
  if (requestedSubjectId === undefined) {
    return callerSubjectId
  }

  const trimmedRequestedSubjectId = requestedSubjectId.trim()
  if (trimmedRequestedSubjectId.length === 0) {
    throw new ConnectError("sendAsSubjectId must not be empty", Code.InvalidArgument)
  }

  if (trimmedRequestedSubjectId === callerSubjectId) {
    return trimmedRequestedSubjectId
  }

  const permissionCheck = await authzService.checkPermission({
    permissionName: WellKnownPermissions.TELEGRAM_NOTIFICATION_SEND_AS_SUBJECT,
    subjectId: callerSubjectId,
    scope: trimmedRequestedSubjectId,
  })

  if (!permissionCheck.authorized) {
    throw new ConnectError(
      `Subject "${callerSubjectId}" is not allowed to send notifications as subject "${trimmedRequestedSubjectId}"`,
      Code.PermissionDenied,
    )
  }

  return trimmedRequestedSubjectId
}

export async function resolveSenderDisplayTitle(
  accessSubjectService: SubjectServiceClientLike,
  subjectId: string,
  fallbackTitle: string,
): Promise<string> {
  try {
    const displayInfo = await accessSubjectService.getSubjectDisplayInfo({
      subjectId,
    })

    if (displayInfo.title.length > 0) {
      return displayInfo.title
    }

    return fallbackTitle
  } catch (error) {
    logger.warn({ error, subjectId }, "failed to resolve sender display title through access")
    return fallbackTitle
  }
}

export async function parseInteractionContextToken(
  crypto: ResideCrypto,
  token: string | undefined,
  systemChatId: string,
): Promise<{
  chatId: string
  messageId: number | undefined
}> {
  if (token === undefined || token.trim().length === 0) {
    return {
      chatId: systemChatId,
      messageId: undefined,
    }
  }

  try {
    const context = await decryptInteractionContextToken(crypto, token)

    return {
      chatId: context.chat_id,
      messageId: context.message_id,
    }
  } catch (error) {
    throw new ConnectError(
      `Invalid context token: ${error instanceof Error ? error.message : String(error)}`,
      Code.InvalidArgument,
    )
  }
}

export async function ensureTargetChatExists(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  targetChatId: string,
): Promise<{ id: number }> {
  const telegramRhid = rhid(targetChatId)
  const dataEcid = await crypto.encrypt({ id: targetChatId })

  return await prisma.chat.upsert({
    where: {
      telegramRhid,
    },
    create: {
      telegramRhid,
      dataEcid,
    },
    update: {
      dataEcid,
    },
    select: {
      id: true,
    },
  })
}
