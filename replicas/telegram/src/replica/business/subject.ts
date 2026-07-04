import type { ResideCrypto } from "@reside/common/encryption"
import type { PrismaClient } from "../../database"
import type { TelegramUserData } from "../../definitions"
import { rhid } from "@reside/common"
import { telegramUserDataSchema } from "../../definitions"
import { strings } from "../../locale"

export function toTelegramSubjectId(userId: number): string {
  return `telegram:${userId}`
}

export async function resolveTelegramSubjectIdByTelegramUserId(
  prisma: PrismaClient,
  telegramUserId: number | string,
): Promise<string | undefined> {
  const user = await prisma.user.findUnique({
    where: {
      telegramRhid: rhidTelegramUserId(telegramUserId),
    },
    select: {
      id: true,
    },
  })

  return user === null ? undefined : toTelegramSubjectId(user.id)
}

function rhidTelegramUserId(telegramUserId: number | string): string {
  return rhid(String(telegramUserId))
}

export async function resolveTelegramSubjectDisplayInfo(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  subjectId: string,
): Promise<{ title: string }> {
  const parsedSubject = parseTelegramSubjectId(subjectId)
  if (!parsedSubject) {
    throw new Error('Subject ID must match format "telegram:{id}"')
  }

  const user = await prisma.user.findUnique({
    where: {
      id: parsedSubject.id,
    },
    select: {
      dataEcid: true,
    },
  })

  if (!user) {
    throw new Error(`Subject "${subjectId}" was not found`)
  }

  const data = await crypto.decrypt(telegramUserDataSchema, user.dataEcid)

  return {
    title: toTelegramUserTitle(String(parsedSubject.id), data),
  }
}

export function parseTelegramSubjectId(subjectId: string): { id: number } | null {
  const segments = subjectId.trim().split(":")
  if (segments.length !== 2) {
    return null
  }

  const realm = segments[0]
  const rawId = segments[1]
  if (realm !== "telegram" || !rawId) {
    return null
  }

  const id = Number(rawId)
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== rawId) {
    return null
  }

  return { id }
}

export function toTelegramUserTitle(fallbackId: string, data: TelegramUserData): string {
  if (typeof data.username === "string" && data.username.length > 0) {
    return data.username
  }

  const firstName = typeof data.first_name === "string" ? data.first_name : ""
  const lastName = typeof data.last_name === "string" ? data.last_name : ""
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim()
  if (fullName.length > 0) {
    return fullName
  }

  return strings.server.subject.userById(fallbackId)
}
