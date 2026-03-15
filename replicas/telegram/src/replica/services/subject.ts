import type {
  GetSubjectDisplayInfoRequest,
  SubjectDisplayInfo,
  SubjectServiceImplementation,
} from "@reside/api/common/subject.v1"
import type { PrismaClient } from "../../database"
import { status } from "@grpc/grpc-js"
import { authenticateReplica, logger } from "@reside/common"
import { type CallContext, ServerError } from "nice-grpc"
import { strings } from "../../locale"

export function createSubjectService(prisma: PrismaClient): SubjectServiceImplementation {
  return {
    async getSubjectDisplayInfo(
      request: GetSubjectDisplayInfoRequest,
      context: CallContext,
    ): Promise<SubjectDisplayInfo> {
      const identity = await authenticateReplica(context)
      if (identity.name !== "access" && identity.name !== "telegram") {
        throw new ServerError(
          status.PERMISSION_DENIED,
          `Replica "${identity.name}" is not allowed to query telegram subject display info`,
        )
      }

      logger.debug("getSubjectDisplayInfo requested for subjectId %s", request.subjectId)

      const parsedSubject = parseTelegramSubjectId(request.subjectId)
      if (!parsedSubject) {
        throw new ServerError(
          status.INVALID_ARGUMENT,
          'Subject ID must match format "telegram:{userId}"',
        )
      }

      const user = await prisma.user.findUnique({
        where: {
          telegramId: parsedSubject.userId,
        },
        select: {
          telegramId: true,
          data: true,
        },
      })

      if (!user) {
        throw new ServerError(status.NOT_FOUND, `Subject "${request.subjectId}" was not found`)
      }

      logger.debug("resolved subject display info for subjectId %s", request.subjectId)

      return {
        title: toTelegramUserTitle(user.telegramId, user.data as PrismaJson.UserData),
        avatarUrl: undefined,
      }
    },
  }
}

function parseTelegramSubjectId(subjectId: string): { userId: string } | null {
  const segments = subjectId.trim().split(":")
  if (segments.length !== 2) {
    return null
  }

  const realm = segments[0]
  const userId = segments[1]
  if (realm !== "telegram" || !userId) {
    return null
  }

  return { userId }
}

function toTelegramUserTitle(telegramId: string, data: PrismaJson.UserData): string {
  if (typeof data.username === "string" && data.username.length > 0) {
    return data.username
  }

  const firstName = typeof data.first_name === "string" ? data.first_name : ""
  const lastName = typeof data.last_name === "string" ? data.last_name : ""
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim()
  if (fullName.length > 0) {
    return fullName
  }

  return strings.server.subject.userById(telegramId)
}
