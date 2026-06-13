import type { BankActivities } from "../../definitions"
import type { BankServices } from "../../shared"
import { crypto } from "@reside/common"
import { getBalance, getSecurityAuditReport, getTransactions, transferAmount } from "../business"

type BankActivityServices = Pick<BankServices, "prisma">

export function createBankActivities({ prisma }: BankActivityServices): BankActivities {
  return {
    async getBalance(input) {
      return { amount: await getBalance(crypto, prisma, input.subjectRhid) }
    },
    async getTransactions(input) {
      return { lines: await getTransactions(crypto, prisma, input.subjectRhid) }
    },
    async transfer(input) {
      return {
        amount: await transferAmount(
          crypto,
          prisma,
          input.senderSubjectRhid,
          input.recipientSubjectRhid,
          input.amount,
        ),
      }
    },
    async getSecurityAuditReport() {
      return getSecurityAuditReport()
    },
  }
}
