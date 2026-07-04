import type { ResideCrypto } from "@reside/common/encryption"
import type { PrismaClient } from "../../database"
import { z } from "zod"
import {
  InsufficientFundsError,
  InvalidTransferAmountError,
  InvalidTransferRecipientError,
} from "../../definitions"
import { strings } from "../../locale"

const initialBalance = 100n
const encryptedAmountSchema = z.object({ amount: z.string() })
type BankPrisma = Pick<PrismaClient, "account" | "transaction" | "$executeRaw" | "$transaction">

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
    select: {
      senderAccount: { select: { subjectRhid: true } },
      recipientAccountId: true,
      amountEcid: true,
      createdAt: true,
    },
  })
  const lines: string[] = []
  for (const row of rows) {
    const amount = await decryptAmount(crypto, row.amountEcid)
    const sign = row.recipientAccountId === account.id ? "+" : "-"
    lines.push(
      strings.notifications.transactions.line(
        row.createdAt.toISOString(),
        sign,
        amount,
        row.senderAccount.subjectRhid,
      ),
    )
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
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new InvalidTransferAmountError(amount)
  }

  if (senderSubjectRhid === recipientSubjectRhid) {
    throw new InvalidTransferRecipientError(recipientSubjectRhid)
  }

  return await prisma.$transaction(async tx => {
    const sender = await ensureAccount(crypto, tx, senderSubjectRhid)
    const recipient = await ensureAccount(crypto, tx, recipientSubjectRhid)

    await lockAccounts(tx, [sender.id, recipient.id])

    const lockedSender = await findAccountById(tx, sender.id)
    const lockedRecipient = await findAccountById(tx, recipient.id)
    const senderBalance = BigInt(await decryptAmount(crypto, lockedSender.balanceEcid))
    const transfer = BigInt(amount)
    if (senderBalance < transfer) {
      throw new InsufficientFundsError(senderBalance, transfer)
    }
    const recipientBalance = BigInt(await decryptAmount(crypto, lockedRecipient.balanceEcid))
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
  return await prisma.account.upsert({
    where: { subjectRhid },
    create: { subjectRhid, balanceEcid: await encryptAmount(crypto, initialBalance) },
    update: {},
    select: { id: true, balanceEcid: true },
  })
}

async function findAccountById(
  prisma: Pick<PrismaClient, "account">,
  id: string,
): Promise<{ id: string; balanceEcid: string }> {
  return await prisma.account.findUniqueOrThrow({
    where: { id },
    select: { id: true, balanceEcid: true },
  })
}

async function lockAccounts(
  prisma: Pick<PrismaClient, "$executeRaw">,
  accountIds: string[],
): Promise<void> {
  const [firstId, secondId] = [...accountIds].sort()
  if (firstId === undefined || secondId === undefined) {
    throw new Error("Failed to lock transfer accounts")
  }

  await prisma.$executeRaw`SELECT id FROM "Account" WHERE id IN (${firstId}, ${secondId}) ORDER BY id FOR UPDATE`
}

async function encryptAmount(crypto: ResideCrypto, amount: bigint): Promise<string> {
  return await crypto.encrypt({ amount: amount.toString() })
}

async function decryptAmount(crypto: ResideCrypto, ecid: string): Promise<string> {
  const value = await crypto.decrypt(encryptedAmountSchema, ecid)
  return value.amount
}
