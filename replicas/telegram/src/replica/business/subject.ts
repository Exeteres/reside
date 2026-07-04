import type { ResideCrypto } from "@reside/common/encryption"
import type { PrismaClient } from "../../database"
import { rhid } from "@reside/common"
import { encryptedStringSchema } from "../../definitions"
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
      telegramUserIdEcid: true,
      usernameEcid: true,
      firstNameEcid: true,
      lastNameEcid: true,
    },
  })

  if (!user) {
    throw new Error(`Subject "${subjectId}" was not found`)
  }

  const username = await decryptOptionalString(crypto, user.usernameEcid)
  const firstName = await decryptOptionalString(crypto, user.firstNameEcid)
  const lastName = await decryptOptionalString(crypto, user.lastNameEcid)

  return {
    title: toTelegramUserTitle(String(parsedSubject.id), {
      username,
      first_name: firstName,
      last_name: lastName,
    } as PrismaJson.UserData),
  }
}

async function decryptOptionalString(
  crypto: ResideCrypto,
  ecid: string | null,
): Promise<string | undefined> {
  if (ecid === null) {
    return undefined
  }

  return await crypto.decrypt(encryptedStringSchema, ecid)
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

export function toTelegramUserTitle(fallbackId: string, data: PrismaJson.UserData): string {
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
