import type { ResideCrypto } from "@reside/common/encryption"
import type { PrismaClient } from "../../database"
import { rhid } from "@reside/common"
import { z } from "zod"

const encryptedStringSchema = z.string()

export async function getBalance(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  subjectId: string,
): Promise<bigint> {
  const account = await ensureAccount(crypto, prisma, subjectId)
  return account.balance
}

export async function getHistory(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  subjectId: string,
): Promise<string[]> {
  const account = await ensureAccount(crypto, prisma, subjectId)
  const entries = await prisma.ledgerEntry.findMany({
    where: { OR: [{ senderId: account.id }, { recipientId: account.id }] },
    orderBy: { createdAt: "desc" },
    take: 10,
  })

  return await Promise.all(
    entries.map(async entry => {
      const sign = entry.recipientId === account.id ? "+" : "-"
      const label = await crypto.decrypt(encryptedStringSchema, entry.recipientLabelEcid)
      return `${sign}${entry.amount} ∅ — ${label}`
    }),
  )
}

export async function transferCurrency(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  senderSubjectId: string,
  recipientSubjectId: string,
  recipientLabel: string,
  amountText: string,
): Promise<{ balance: bigint }> {
  const amount = parseAmount(amountText)
  const sender = await ensureAccount(crypto, prisma, senderSubjectId)
  const recipient = await ensureAccount(crypto, prisma, recipientSubjectId)

  if (sender.id === recipient.id) {
    throw new Error("Cannot transfer currency to self")
  }

  if (sender.balance < amount) {
    throw new Error("Insufficient funds")
  }

  const result = await prisma.$transaction(async tx => {
    const updatedSender = await tx.account.update({
      where: { id: sender.id },
      data: { balance: { decrement: amount } },
      select: { balance: true },
    })

    await tx.account.update({
      where: { id: recipient.id },
      data: { balance: { increment: amount } },
      select: { id: true },
    })

    await tx.ledgerEntry.create({
      data: {
        senderId: sender.id,
        recipientId: recipient.id,
        amount,
        recipientLabelEcid: await crypto.encrypt(recipientLabel),
      },
      select: { id: true },
    })

    return updatedSender
  })

  return { balance: result.balance }
}

async function ensureAccount(
  crypto: ResideCrypto,
  prisma: PrismaClient,
  subjectId: string,
): Promise<{ id: number; balance: bigint }> {
  const subjectRhid = rhid(subjectId)
  const existing = await prisma.account.findUnique({
    where: { subjectRhid },
    select: { id: true, balance: true },
  })

  if (existing) {
    return existing
  }

  return await prisma.account.create({
    data: { subjectRhid, subjectEcid: await crypto.encrypt(subjectId) },
    select: { id: true, balance: true },
  })
}

function parseAmount(value: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value.trim())) {
    throw new Error("Amount must be a positive integer")
  }

  return BigInt(value.trim())
}
