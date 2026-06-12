import type { PrismaClient } from "../../database"
import type { BankActivities } from "../../definitions"
import { getBalance, getHistory, transferCurrency } from "../business"

export function createBankActivities({ prisma }: { prisma: PrismaClient }): BankActivities {
  return {
    async getBalance(subjectId) {
      return await getBalance(prisma, subjectId)
    },
    async getHistory(subjectId) {
      return await getHistory(prisma, subjectId)
    },
    async transferCurrency(input) {
      return await transferCurrency(prisma, input)
    },
  }
}
