import type { BankServices } from "../../shared"
import { defineTool } from "@github/copilot-sdk"
import { crypto } from "@reside/common"
import { z } from "zod"
import { InsufficientFundsError, InvalidTransferAmountError } from "../../definitions"
import { strings } from "../../locale"
import { getBalance, getTransactions, transferAmount } from "../business"

type BankToolServices = Pick<BankServices, "prisma">

export function createBankTools({ prisma }: BankToolServices) {
  return [
    defineTool("get_balance", {
      description: "Gets an encrypted bank account balance by opaque Telegram subject RHID.",
      parameters: z.object({ subjectRhid: z.string().min(1) }),
      handler: async ({ subjectRhid }) => ({
        response: `${await getBalance(crypto, prisma, subjectRhid)} ∅`,
      }),
    }),
    defineTool("get_transactions", {
      description: "Gets recent transaction history by opaque Telegram subject RHID.",
      parameters: z.object({ subjectRhid: z.string().min(1) }),
      handler: async ({ subjectRhid }) => ({
        transactions: await getTransactions(crypto, prisma, subjectRhid),
      }),
    }),
    defineTool("transfer", {
      description: "Transfers нихуя between two opaque Telegram subject RHIDs.",
      parameters: z.object({
        senderSubjectRhid: z.string().min(1),
        recipientSubjectRhid: z.string().min(1),
        amount: z.number().int().positive(),
      }),
      handler: async ({ senderSubjectRhid, recipientSubjectRhid, amount }) => {
        try {
          const transferredAmount = await transferAmount(
            crypto,
            prisma,
            senderSubjectRhid,
            recipientSubjectRhid,
            amount,
          )
          return { response: strings.notifications.transfer.success(transferredAmount) }
        } catch (error) {
          return { response: getTransferFailureResponse(error) }
        }
      },
    }),
  ]
}

function getTransferFailureResponse(error: unknown): string {
  if (error instanceof InsufficientFundsError) {
    return strings.notifications.errors.insufficientFunds
  }

  if (error instanceof InvalidTransferAmountError) {
    return strings.notifications.errors.invalidAmount
  }

  return strings.notifications.transfer.failure
}
