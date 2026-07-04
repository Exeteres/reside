import type { BankServices } from "../../shared"
import { crypto, defineTool } from "@reside/common"
import { z } from "zod"
import { strings } from "../../locale"
import { getBalance, getTransactions, transferAmount } from "../business"

type BankToolServices = Pick<BankServices, "prisma">

export function createBankTools({ prisma }: BankToolServices) {
  return [
    defineTool("reside_bank_get_balance", {
      description: strings.nls.tools.balance,
      parameters: z.object({ subjectRhid: z.string().min(1) }),
      handler: async ({ subjectRhid }) => ({
        response: strings.notifications.balance(await getBalance(crypto, prisma, subjectRhid)),
      }),
    }),
    defineTool("reside_bank_get_transactions", {
      description: strings.nls.tools.transactions,
      parameters: z.object({ subjectRhid: z.string().min(1) }),
      handler: async ({ subjectRhid }) => {
        const transactions = await getTransactions(crypto, prisma, subjectRhid)

        return {
          transactions,
          response:
            transactions.length === 0
              ? strings.notifications.transactions.empty
              : [strings.notifications.transactions.title, ...transactions].join("\n"),
        }
      },
    }),
    defineTool("reside_bank_transfer", {
      description: strings.nls.tools.transfer,
      parameters: z.object({
        senderSubjectRhid: z.string().min(1),
        recipientSubjectRhid: z.string().min(1),
        amount: z.number().int().positive(),
      }),
      handler: async ({ senderSubjectRhid, recipientSubjectRhid, amount }) => {
        const transferredAmount = await transferAmount(
          crypto,
          prisma,
          senderSubjectRhid,
          recipientSubjectRhid,
          amount,
        )

        return { response: strings.notifications.transfer.success(transferredAmount) }
      },
    }),
  ]
}
