import type { ResideCrypto } from "@reside/common/encryption"
import type { PrismaClient } from "../../database"
import { defineTool } from "@github/copilot-sdk"
import { z } from "zod"
import { getBalance, getHistory, transferCurrency } from "../business"

export function createBankTools({
  crypto,
  prisma,
}: {
  crypto: ResideCrypto
  prisma: PrismaClient
}) {
  return [
    defineTool("get_balance", {
      description: "Gets a user's bank balance by opaque subject id.",
      parameters: z.object({ subjectId: z.string() }),
      handler: async ({ subjectId }) => ({
        balance: String(await getBalance(crypto, prisma, subjectId)),
        currency: "∅",
      }),
    }),
    defineTool("get_history", {
      description: "Gets a user's last bank operations by opaque subject id.",
      parameters: z.object({ subjectId: z.string() }),
      handler: async ({ subjectId }) => ({
        operations: await getHistory(crypto, prisma, subjectId),
        currency: "∅",
      }),
    }),
    defineTool("transfer_currency", {
      description: "Transfers ∅ between opaque subject ids.",
      parameters: z.object({
        senderSubjectId: z.string(),
        recipientSubjectId: z.string(),
        amount: z.string(),
      }),
      handler: async ({ senderSubjectId, recipientSubjectId, amount }) => {
        const result = await transferCurrency(
          crypto,
          prisma,
          senderSubjectId,
          recipientSubjectId,
          "получатель",
          amount,
        )
        return { balance: String(result.balance), currency: "∅" }
      },
    }),
  ]
}
