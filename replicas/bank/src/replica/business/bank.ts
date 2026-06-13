import type { ResideCrypto } from "@reside/common"
import type { PrismaClient } from "../../database"
import { z } from "zod"

const encryptedAmountSchema = z.object({ amount: z.string() })
type BankPrisma = Pick<PrismaClient, "account" | "transaction" | "$transaction">

export async function getBalance(
  crypto: ResideCrypto,
  prisma: BankPrisma,
  subjectRhid: string,
): Promise<string> {
  const account = await ensureAccount(crypto, prisma, subjectRhid)
  return await decryptAmount(crypto, account.balanceEcid)
}

export async function getTransactions(
  crypto: ResideCrypto,
  prisma: BankPrisma,
  subjectRhid: string,
): Promise<string[]> {
  const account = await ensureAccount(crypto, prisma, subjectRhid)
  const rows = await prisma.transaction.findMany({
    where: { OR: [{ senderAccountId: account.id }, { recipientAccountId: account.id }] },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { senderAccountId: true, recipientAccountId: true, amountEcid: true, createdAt: true },
  })
  const lines: string[] = []
  for (const row of rows) {
    const amount = await decryptAmount(crypto, row.amountEcid)
    const sign = row.recipientAccountId === account.id ? "+" : "-"
    lines.push(`${row.createdAt.toISOString()} ${sign}${amount} ∅`)
  }
  return lines
}

export async function transferAmount(
  crypto: ResideCrypto,
  prisma: BankPrisma,
  senderSubjectRhid: string,
  recipientSubjectRhid: string,
  amount: number,
): Promise<string> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("invalid_amount")
  return await prisma.$transaction(async tx => {
    const sender = await ensureAccount(crypto, tx, senderSubjectRhid)
    const recipient = await ensureAccount(crypto, tx, recipientSubjectRhid)
    const senderBalance = BigInt(await decryptAmount(crypto, sender.balanceEcid))
    const transfer = BigInt(amount)
    if (senderBalance < transfer) throw new Error("insufficient_funds")
    const recipientBalance = BigInt(await decryptAmount(crypto, recipient.balanceEcid))
    const amountText = transfer.toString()
    await tx.account.update({
      where: { id: sender.id },
      data: { balanceEcid: await encryptAmount(crypto, senderBalance - transfer) },
    })
    await tx.account.update({
      where: { id: recipient.id },
      data: { balanceEcid: await encryptAmount(crypto, recipientBalance + transfer) },
    })
    await tx.transaction.create({
      data: {
        senderAccountId: sender.id,
        recipientAccountId: recipient.id,
        amountEcid: await crypto.encrypt({ amount: amountText }),
      },
    })
    return amountText
  })
}

async function ensureAccount(
  crypto: ResideCrypto,
  prisma: Pick<PrismaClient, "account">,
  subjectRhid: string,
): Promise<{ id: string; balanceEcid: string }> {
  const existing = await prisma.account.findUnique({
    where: { subjectRhid },
    select: { id: true, balanceEcid: true },
  })
  if (existing) return existing
  return await prisma.account.create({
    data: { subjectRhid, balanceEcid: await encryptAmount(crypto, 0n) },
    select: { id: true, balanceEcid: true },
  })
}

async function encryptAmount(crypto: ResideCrypto, amount: bigint): Promise<string> {
  return await crypto.encrypt({ amount: amount.toString() })
}

async function decryptAmount(crypto: ResideCrypto, ecid: string): Promise<string> {
  const value = await crypto.decrypt(encryptedAmountSchema, ecid)
  return value.amount
}
