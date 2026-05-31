import type { PrismaClient } from "../../database"
import { strings } from "../../locale"

export async function resolveTelegramSubjectDisplayInfo(
  prisma: PrismaClient,
  subjectId: string,
): Promise<{ title: string }> {
  const parsedSubject = parseTelegramSubjectId(subjectId)
  if (!parsedSubject) {
    throw new Error('Subject ID must match format "telegram:{userId}"')
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
    throw new Error(`Subject "${subjectId}" was not found`)
  }

  return {
    title: toTelegramUserTitle(user.telegramId, user.data as PrismaJson.UserData),
  }
}

export function parseTelegramSubjectId(subjectId: string): { userId: string } | null {
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

export function toTelegramUserTitle(telegramId: string, data: PrismaJson.UserData): string {
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
