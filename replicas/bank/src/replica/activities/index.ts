import type { ResideCrypto } from "@reside/common/encryption"
import type { PrismaClient } from "../../database"
import type { BankActivities } from "../../definitions"
import { strings } from "../../locale"
import { getBalance, getHistory, transferCurrency } from "../business"

export function createBankActivities({
  crypto,
  prisma,
}: {
  crypto: ResideCrypto
  prisma: PrismaClient
}): BankActivities {
  return {
    async getBalance(subjectId) {
      return { balance: String(await getBalance(crypto, prisma, subjectId)) }
    },
    async getHistory(subjectId) {
      const lines = await getHistory(crypto, prisma, subjectId)
      return {
        title:
          lines.length === 0
            ? strings.notifications.historyEmpty
            : strings.notifications.historyTitle,
        lines,
      }
    },
    async transfer(subjectId, recipient, amount) {
      const recipientSubjectId = resolveTelegramRecipient(recipient)
      const result = await transferCurrency(
        crypto,
        prisma,
        subjectId,
        recipientSubjectId,
        recipient,
        amount,
      )
      return {
        title: strings.notifications.transferSuccess(amount, recipient, String(result.balance)),
      }
    },
  }
}

export function resolveTelegramRecipient(input: string): string {
  const trimmed = input.trim()
  const mentionMatch = /^\[.+\]\(tg:\/\/user\?id=([0-9]+)\)$/.exec(trimmed)
  if (mentionMatch) {
    return `telegram:${mentionMatch[1]}`
  }

  const username = trimmed.replace(/^@/, "")
  if (/^[a-zA-Z0-9_]{5,32}$/.test(username)) {
    return `telegram:username:${username.toLowerCase()}`
  }

  throw new Error("Recipient must be a Telegram username or mention")
}
