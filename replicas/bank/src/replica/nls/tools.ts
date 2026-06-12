import type { PrismaClient } from "../../database"
import { defineTool } from "@github/copilot-sdk"
import { z } from "zod"
import { getBalance, getHistory, transferCurrency } from "../business"

export function createBankTools({ prisma }: { prisma: PrismaClient }) {
  return [
    defineTool("get_bank_balance", {
      description: "Gets the current balance of virtual currency nihuya (∅) for a subject.",
      parameters: z.object({ subjectId: z.string() }),
      handler: async ({ subjectId }) => {
        const balance = await getBalance(prisma, subjectId)
        return {
          ...balance,
          currency: "нихуя",
          symbol: "∅",
          response: `Баланс: ${balance.balance}∅.`,
        }
      },
    }),
    defineTool("get_bank_history", {
      description: "Gets recent virtual currency nihuya (∅) transfer history for a subject.",
      parameters: z.object({ subjectId: z.string() }),
      handler: async ({ subjectId }) => {
        const history = await getHistory(prisma, subjectId)
        return { ...history, currency: "нихуя", symbol: "∅" }
      },
    }),
    defineTool("transfer_bank_currency", {
      description: "Transfers virtual currency nihuya (∅) to a Telegram username or mention.",
      parameters: z.object({
        senderSubjectId: z.string(),
        recipient: z.string(),
        amount: z.number().int().positive(),
      }),
      handler: async ({ senderSubjectId, recipient, amount }) => {
        try {
          const result = await transferCurrency(prisma, {
            senderSubjectId,
            recipientHandle: recipient,
            amount,
          })
          return { ...result, currency: "нихуя", symbol: "∅", response: `Переведено ${amount}∅.` }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          return { response: `Не удалось выполнить перевод: ${reason}` }
        }
      },
    }),
  ]
}
