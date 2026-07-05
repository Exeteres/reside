import type { ResideCrypto } from "@reside/common/encryption"
import type { PrismaClient } from "../../database"
import { rhid } from "@reside/common"
import { telegramUserDataSchema } from "../../definitions"
import { parseTelegramSubjectId, toTelegramSubjectId } from "./subject"

const USERNAME_PATTERN = /^@?[A-Za-z0-9_]{5,32}$/
const TELEGRAM_USER_ID_PATTERN = /^\d+$/

export async function replaceUserReferencesWithSubjectIds(args: {
  crypto: ResideCrypto
  prisma: PrismaClient
  text: string
}): Promise<string> {
  const tokens = args.text.split(/(\s+)/)
  const candidateValues = new Set(
    tokens
      .filter(token => token.trim() === token && token.length > 0)
      .filter(token => USERNAME_PATTERN.test(token) || TELEGRAM_USER_ID_PATTERN.test(token)),
  )
  if (candidateValues.size === 0) {
    return args.text
  }

  const replacements = await resolveUserReferenceReplacements(args, [...candidateValues])
  if (replacements.size === 0) {
    return args.text
  }

  return tokens.map(token => replacements.get(token) ?? token).join("")
}

export async function resolveUserReferenceToSubjectId(args: {
  crypto: ResideCrypto
  prisma: PrismaClient
  value: string
}): Promise<string | undefined> {
  if (parseTelegramSubjectId(args.value) !== null) {
    return args.value
  }

  if (!USERNAME_PATTERN.test(args.value) && !TELEGRAM_USER_ID_PATTERN.test(args.value)) {
    return undefined
  }

  const replacements = await resolveUserReferenceReplacements(args, [args.value])
  return replacements.get(args.value)
}

async function resolveUserReferenceReplacements(
  args: {
    crypto: ResideCrypto
    prisma: PrismaClient
  },
  values: string[],
): Promise<Map<string, string>> {
  const replacements = new Map<string, string>()
  const numericValues = values.filter(value => TELEGRAM_USER_ID_PATTERN.test(value))
  for (const value of numericValues) {
    const user = await args.prisma.user.findUnique({
      where: {
        telegramRhid: rhid(value),
      },
      select: {
        id: true,
      },
    })
    if (user !== null) {
      replacements.set(value, toTelegramSubjectId(user.id))
    }
  }

  const usernameValues = new Map(
    values
      .filter(value => USERNAME_PATTERN.test(value))
      .map(value => [value.replace(/^@/, "").toLowerCase(), value] as const),
  )
  if (usernameValues.size === 0) {
    return replacements
  }

  for (const [normalizedUsername, originalValue] of usernameValues) {
    const user = await args.prisma.user.findUnique({
      where: {
        usernameRhid: rhid(normalizedUsername),
      },
      select: {
        id: true,
      },
    })
    if (user !== null) {
      replacements.set(originalValue, toTelegramSubjectId(user.id))
      usernameValues.delete(normalizedUsername)
    }
  }

  if (usernameValues.size === 0) {
    return replacements
  }

  const users = await args.prisma.user.findMany({
    select: {
      id: true,
      dataEcid: true,
    },
  })

  for (const user of users) {
    if (user.dataEcid === null) {
      continue
    }

    const data = await args.crypto.decrypt(telegramUserDataSchema, user.dataEcid)
    if (data.username === undefined) {
      continue
    }

    const matchedValue = usernameValues.get(data.username.toLowerCase())
    if (matchedValue !== undefined) {
      replacements.set(matchedValue, toTelegramSubjectId(user.id))
    }
  }

  return replacements
}
