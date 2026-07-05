import type { BankServices } from "../../shared"
import { crypto, defineTool } from "@reside/common"
import { z } from "zod"
import { getBalance, listTransactions, transfer } from "../business"

type BankToolServices = Pick<BankServices, "prisma">

export function createBankTools({ prisma }: BankToolServices) {
  return [
    defineTool("reside_bank_get_balance", {
      description:
        "Gets the ∅ balance for the current subject. Use the subject ID from the interaction system prompt.",
      parameters: z.object({
        subjectId: z.string(),
      }),
      handler: async ({ subjectId }) => {
        const balance = await getBalance(crypto, prisma, subjectId)

        return {
          balance,
          currency: "∅",
          response: `Balance is ${balance} ∅.`,
        }
      },
    }),
    defineTool("reside_bank_list_transactions", {
      description: "Lists ∅ transactions for the current subject with cursor pagination.",
      parameters: z.object({
        subjectId: z.string(),
        pageSize: z.number().int().positive().max(50).optional(),
        pageToken: z.string().optional(),
      }),
      handler: async ({ subjectId, pageSize, pageToken }) => {
        const result = await listTransactions(crypto, prisma, { subjectId, pageSize, pageToken })

        return {
          ...result,
          currency: "∅",
          response: `Found ${result.transactions.length} transaction(s).`,
        }
      },
    }),
    defineTool("reside_bank_transfer", {
      description:
        "Transfers ∅ from the current subject to another subject. Use the tool invocation ID as the idempotency key.",
      parameters: z.object({
        senderSubjectId: z.string(),
        recipientSubjectId: z.string(),
        amount: z.string(),
      }),
      handler: async ({ senderSubjectId, recipientSubjectId, amount }, context) => {
        const transaction = await transfer(crypto, prisma, {
          senderSubjectId,
          recipientSubjectId,
          amount,
          idempotencyKey: context.invocationId,
        })

        return {
          transaction,
          currency: "∅",
          response: `Transferred ${transaction.amount} ∅.`,
        }
      },
    }),
  ]
}
