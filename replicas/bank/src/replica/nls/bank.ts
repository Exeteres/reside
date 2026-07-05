import type { BankServices } from "../../shared"
import { crypto, defineTool } from "@reside/common"
import { z } from "zod"
import { getBalance, listTransactionAmountReferences, transfer } from "../business"

type BankToolServices = Pick<BankServices, "prisma">

export function createBankTools({ prisma }: BankToolServices) {
  return [
    defineTool("reside_bank_get_balance", {
      description:
        "Gets the ∅ balance for the current interaction subject. Use only the current subject ID from the interaction system prompt.",
      parameters: z.object({
        currentSubjectId: z.string(),
      }),
      handler: async ({ currentSubjectId }) => {
        const balance = await getBalance(crypto, prisma, currentSubjectId)

        return {
          balance,
          currency: "∅",
          response: `Balance is ${balance} ∅.`,
        }
      },
    }),
    defineTool("reside_bank_transfer", {
      description:
        "Transfers ∅ from the current interaction subject to another subject. Use the tool invocation ID as the idempotency key.",
      parameters: z.object({
        currentSubjectId: z.string(),
        recipientSubjectId: z.string(),
        amount: z.string(),
      }),
      handler: async ({ currentSubjectId, recipientSubjectId, amount }, context) => {
        const transaction = await transfer(crypto, prisma, {
          senderSubjectId: currentSubjectId,
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
    defineTool("reside_bank_list_transactions", {
      description:
        "Lists ∅ transactions for the current interaction subject with cursor pagination. Amounts are returned as ECIDs and must not be rewritten as plaintext by the model.",
      parameters: z.object({
        currentSubjectId: z.string(),
        pageSize: z.number().int().positive().max(50).optional(),
        pageToken: z.string().optional(),
      }),
      handler: async ({ currentSubjectId, pageSize, pageToken }) => {
        const result = await listTransactionAmountReferences(crypto, prisma, {
          subjectId: currentSubjectId,
          pageSize,
          pageToken,
        })

        return {
          ...result,
          currency: "∅",
          response: `Found ${result.transactions.length} transaction(s). Use amountEcid values instead of plaintext amounts.`,
        }
      },
    }),
  ]
}
