import type { ResideCrypto } from "@reside/common/encryption"
import type { PrismaClient } from "../../database"
import type { SubjectServiceClientLike } from "./notification-types"
import { encryptedStringSchema } from "../../definitions"
import { parseTelegramSubjectId, toTelegramUserTitle } from "./subject"

const SUBJECT_TOKEN_PATTERN = /(^|\s)((?:telegram|replica):[a-zA-Z0-9._-]+)(?=$|\s)/g

export async function replaceSubjectIdsWithTitles(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  subjectService: SubjectServiceClientLike,
  text: string,
): Promise<string> {
  const matches = Array.from(text.matchAll(SUBJECT_TOKEN_PATTERN))
  if (matches.length === 0) {
    return text
  }

  const titlesBySubjectId = new Map<string, string>()
  for (const match of matches) {
    const subjectId = match[2]
    if (!subjectId || titlesBySubjectId.has(subjectId)) {
      continue
    }

    const title = await resolveSubjectTitle(crypto, prisma, subjectService, subjectId)
    if (title !== undefined) {
      titlesBySubjectId.set(subjectId, title)
    }
  }

  return text.replace(SUBJECT_TOKEN_PATTERN, (value, prefix: string, subjectId: string) => {
    const title = titlesBySubjectId.get(subjectId)
    return title === undefined ? value : `${prefix}${title}`
  })
}

async function resolveSubjectTitle(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  subjectService: SubjectServiceClientLike,
  subjectId: string,
): Promise<string | undefined> {
  if (subjectId.startsWith("telegram:")) {
    return await resolveTelegramSubjectTitle(crypto, prisma, subjectId)
  }

  if (subjectId.startsWith("replica:")) {
    return await resolveReplicaSubjectTitle(subjectService, subjectId)
  }

  return undefined
}

async function resolveTelegramSubjectTitle(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  subjectId: string,
): Promise<string | undefined> {
  const parsed = parseTelegramSubjectId(subjectId)
  if (parsed === null) {
    return undefined
  }

  const user = await prisma.user.findUnique({
    where: {
      id: parsed.id,
    },
    select: {
      usernameEcid: true,
      firstNameEcid: true,
      lastNameEcid: true,
    },
  })

  if (user === null) {
    return undefined
  }

  const username = await decryptOptionalString(crypto, user.usernameEcid)
  const firstName = await decryptOptionalString(crypto, user.firstNameEcid)
  const lastName = await decryptOptionalString(crypto, user.lastNameEcid)

  return toTelegramUserTitle(String(parsed.id), {
    username,
    first_name: firstName,
    last_name: lastName,
  } as PrismaJson.UserData)
}

async function resolveReplicaSubjectTitle(
  subjectService: SubjectServiceClientLike,
  subjectId: string,
): Promise<string | undefined> {
  try {
    const displayInfo = await subjectService.getSubjectDisplayInfo({ subjectId })
    return displayInfo.title
  } catch {
    return undefined
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
