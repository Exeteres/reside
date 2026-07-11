import type { BankServices } from "../../shared"
import { crypto, defineTool } from "@reside/common"
import { z } from "zod"
import {
  cancelPaymentAuthorization,
  getBalance,
  listPaymentAuthorizations,
  listTransactionAmountReferences,
  transfer,
} from "../business"

type BankToolServices = Pick<BankServices, "prisma">

export function createBankTools({ prisma }: BankToolServices) {
  return [
    defineTool("bank_get_balance", {
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
    defineTool("bank_transfer", {
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
    defineTool("bank_list_transactions", {
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
    defineTool("bank_list_payment_authorizations", {
      description:
        "Lists replicas that the current interaction subject has allowed to request future automatic payments.",
      parameters: z.object({
        currentSubjectId: z.string(),
      }),
      handler: async ({ currentSubjectId }) => {
        const authorizations = await listPaymentAuthorizations(prisma, currentSubjectId)

        return {
          authorizations,
          response:
            authorizations.length === 0
              ? "No payment authorizations found."
              : `Found ${authorizations.length} payment authorization(s).`,
        }
      },
    }),
    defineTool("bank_cancel_payment_authorization", {
      description:
        "Cancels one automatic payment authorization for the current interaction subject. Use an authorization ID returned by bank_list_payment_authorizations.",
      parameters: z.object({
        currentSubjectId: z.string(),
        authorizationId: z.number().int().positive(),
      }),
      handler: async ({ currentSubjectId, authorizationId }) => {
        const authorization = await cancelPaymentAuthorization(prisma, {
          payerSubjectId: currentSubjectId,
          authorizationId,
        })

        return {
          authorization,
          cancelled: authorization !== undefined,
          response:
            authorization === undefined
              ? "Payment authorization was not found."
              : `Cancelled payment authorization for ${authorization.requesterSubjectId}.`,
        }
      },
    }),
  ]
}
