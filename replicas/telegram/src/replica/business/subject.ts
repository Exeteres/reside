import type { ResideCrypto } from "@reside/common/encryption"
import type { PrismaClient } from "../../database"
import { rhid } from "@reside/common"
import { encryptedStringSchema } from "../../definitions"
import { strings } from "../../locale"

export async function resolveTelegramSubjectDisplayInfo(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  subjectId: string,
): Promise<{ title: string }> {
  const parsedSubject = parseTelegramSubjectId(subjectId)
  if (!parsedSubject) {
    throw new Error('Subject ID must match format "telegram:{userId}"')
  }

  const user = await prisma.user.findUnique({
    where: {
      telegramRhid: rhid(parsedSubject.userId),
    },
    select: {
      telegramRhid: true,
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
    title: toTelegramUserTitle(parsedSubject.userId, {
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
