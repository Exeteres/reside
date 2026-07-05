import type { ResideCrypto } from "@reside/common"
import type { PrismaClient } from "../../database"
import type { BankTransaction } from "../../definitions"
import { Code, ConnectError } from "@connectrpc/connect"
import { z } from "zod"

const encryptedAmountSchema = z.string().regex(/^\d+$/)
const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 50

export type BankPrisma = PrismaClient

type TransactionRecord = {
  id: bigint
  kind: "ISSUE" | "TRANSFER"
  sender_subject_id: string | null
  recipient_subject_id: string
  amountEcid: string
  comment: string | null
  createdAt: Date
}

export type TransferInput = {
  senderSubjectId: string
  recipientSubjectId: string
  amount: string
  idempotencyKey: string
  comment?: string
}

export type IssueReplicaFundsInput = {
  replicaName: string
  amount: string
  idempotencyKey: string
  comment?: string
}

export async function getBalance(
  crypto: ResideCrypto,
  prisma: BankPrisma,
  subjectId: string,
): Promise<string> {
  const account = await ensureAccount(crypto, prisma, subjectId)

  return await decryptAmount(crypto, account.balanceEcid)
}

export async function listTransactions(
  crypto: ResideCrypto,
  prisma: BankPrisma,
  input: { subjectId: string; pageSize?: number; pageToken?: string },
): Promise<{ transactions: BankTransaction[]; nextPageToken?: string }> {
  await ensureAccount(crypto, prisma, input.subjectId)

  const pageSize = Math.min(input.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  const cursorId = input.pageToken ? parseBigInt(input.pageToken, "page_token") : undefined
  const rows = await prisma.transaction.findMany({
    where: {
      OR: [{ sender_subject_id: input.subjectId }, { recipient_subject_id: input.subjectId }],
    },
    orderBy: [{ id: "desc" }],
    take: pageSize + 1,
    ...(cursorId === undefined
      ? {}
      : {
          cursor: { id: cursorId },
          skip: 1,
        }),
  })

  const visibleRows = rows.slice(0, pageSize)
  const transactions = await Promise.all(
    visibleRows.map(async row => ({
      id: row.id.toString(),
      kind: row.kind,
      senderSubjectId: row.sender_subject_id ?? undefined,
      recipientSubjectId: row.recipient_subject_id,
      amount: await decryptAmount(crypto, row.amountEcid),
      comment: row.comment ?? undefined,
      createdAt: row.createdAt.toISOString(),
    })),
  )

  return {
    transactions,
    nextPageToken: rows.length > pageSize ? visibleRows.at(-1)?.id.toString() : undefined,
  }
}

export async function transfer(
  crypto: ResideCrypto,
  prisma: BankPrisma,
  input: TransferInput,
): Promise<BankTransaction> {
  const amount = parsePositiveAmount(input.amount)

  if (input.senderSubjectId === input.recipientSubjectId) {
    throw new ConnectError("Sender and recipient must be different", Code.InvalidArgument)
  }

  return await runLedgerWrite(prisma, async ledgerPrisma => {
    const existing = await ledgerPrisma.transaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    })
    if (existing) {
      return await mapTransaction(crypto, existing)
    }

    const sender = await ensureAccount(crypto, ledgerPrisma, input.senderSubjectId)
    const recipient = await ensureAccount(crypto, ledgerPrisma, input.recipientSubjectId)
    const senderBalance = parsePositiveOrZeroAmount(await decryptAmount(crypto, sender.balanceEcid))
    const recipientBalance = parsePositiveOrZeroAmount(
      await decryptAmount(crypto, recipient.balanceEcid),
    )

    if (senderBalance < amount) {
      throw new ConnectError("Insufficient funds", Code.FailedPrecondition)
    }

    const senderBalanceEcid = await crypto.encrypt((senderBalance - amount).toString())
    const recipientBalanceEcid = await crypto.encrypt((recipientBalance + amount).toString())
    const amountEcid = await crypto.encrypt(amount.toString())

    await ledgerPrisma.account.update({
      where: { subject_id: input.senderSubjectId },
      data: { balanceEcid: senderBalanceEcid },
    })
    await ledgerPrisma.account.update({
      where: { subject_id: input.recipientSubjectId },
      data: { balanceEcid: recipientBalanceEcid },
    })

    const transaction = await ledgerPrisma.transaction.create({
      data: {
        kind: "TRANSFER",
        sender_subject_id: input.senderSubjectId,
        recipient_subject_id: input.recipientSubjectId,
        amountEcid,
        idempotencyKey: input.idempotencyKey,
        comment: input.comment,
      },
    })

    return await mapTransaction(crypto, transaction)
  })
}

export async function issueReplicaFunds(
  crypto: ResideCrypto,
  prisma: BankPrisma,
  input: IssueReplicaFundsInput,
): Promise<BankTransaction> {
  const amount = parsePositiveAmount(input.amount)
  const recipientSubjectId = `replica:${input.replicaName}`

  return await runLedgerWrite(prisma, async ledgerPrisma => {
    const existing = await ledgerPrisma.transaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    })
    if (existing) {
      return await mapTransaction(crypto, existing)
    }

    const recipient = await ensureAccount(crypto, ledgerPrisma, recipientSubjectId)
    const recipientBalance = parsePositiveOrZeroAmount(
      await decryptAmount(crypto, recipient.balanceEcid),
    )
    const recipientBalanceEcid = await crypto.encrypt((recipientBalance + amount).toString())
    const amountEcid = await crypto.encrypt(amount.toString())

    await ledgerPrisma.account.update({
      where: { subject_id: recipientSubjectId },
      data: { balanceEcid: recipientBalanceEcid },
    })

    const transaction = await ledgerPrisma.transaction.create({
      data: {
        kind: "ISSUE",
        recipient_subject_id: recipientSubjectId,
        amountEcid,
        idempotencyKey: input.idempotencyKey,
        comment: input.comment,
      },
    })

    return await mapTransaction(crypto, transaction)
  })
}

async function ensureAccount(crypto: ResideCrypto, prisma: BankPrisma, subjectId: string) {
  const existing = await prisma.account.findUnique({ where: { subject_id: subjectId } })
  if (existing) {
    return existing
  }

  const balanceEcid = await crypto.encrypt("0")

  return await prisma.account.upsert({
    where: { subject_id: subjectId },
    create: { subject_id: subjectId, balanceEcid },
    update: {},
  })
}

async function runLedgerWrite<T>(
  prisma: BankPrisma,
  write: (prisma: BankPrisma) => Promise<T>,
): Promise<T> {
  return await prisma.$transaction(async tx => await write(tx as BankPrisma), {
    // crypto.encrypt persists EncryptedContent through the root Prisma client;
    // each ledger statement must see those rows before referencing their ECIDs.
    isolationLevel: "ReadCommitted",
  })
}

async function mapTransaction(
  crypto: ResideCrypto,
  transaction: TransactionRecord,
): Promise<BankTransaction> {
  return {
    id: transaction.id.toString(),
    kind: transaction.kind,
    senderSubjectId: transaction.sender_subject_id ?? undefined,
    recipientSubjectId: transaction.recipient_subject_id,
    amount: await decryptAmount(crypto, transaction.amountEcid),
    comment: transaction.comment ?? undefined,
    createdAt: transaction.createdAt.toISOString(),
  }
}

async function decryptAmount(crypto: ResideCrypto, ecid: string): Promise<string> {
  return await crypto.decrypt(encryptedAmountSchema, ecid)
}

function parsePositiveAmount(value: string): bigint {
  const amount = parsePositiveOrZeroAmount(value)

  if (amount <= 0n) {
    throw new ConnectError("Amount must be positive", Code.InvalidArgument)
  }

  return amount
}

function parsePositiveOrZeroAmount(value: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new ConnectError("Amount must be an integer string", Code.InvalidArgument)
  }

  return BigInt(value)
}

function parseBigInt(value: string, fieldName: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new ConnectError(`${fieldName} must be an integer string`, Code.InvalidArgument)
  }

  return BigInt(value)
}
