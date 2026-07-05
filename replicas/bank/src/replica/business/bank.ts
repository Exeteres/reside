import type { ResideCrypto } from "@reside/common"
import type { Client as TemporalClient } from "@temporalio/client"
import type { PrismaClient } from "../../database"
import type { BankTransaction } from "../../definitions"
import { DEFAULT_TEMPORAL_TASK_QUEUE } from "@reside/common"
import { WorkflowIdReusePolicy } from "@temporalio/client"
import { z } from "zod"
import { BankError } from "../../definitions"
import { strings } from "../../locale"

const encryptedAmountSchema = z.string().regex(/^\d+$/)
const encryptedCommentSchema = z.string()
const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 50
const TELEGRAM_WELCOME_IDEMPOTENCY_PREFIX = "telegram-welcome:"

export type BankPrisma = PrismaClient

type TransactionRecord = {
  id: bigint
  kind: "ISSUE" | "TRANSFER"
  sender_subject_id: string | null
  recipient_subject_id: string
  amountEcid: string
  commentEcid: string | null
  createdAt: Date
}

export type TransferInput = {
  senderSubjectId: string
  recipientSubjectId: string
  amount: string
  idempotencyKey: string
  comment?: string
}

export type BankTransactionAmountReference = Omit<BankTransaction, "amount" | "comment"> & {
  amountEcid: string
  commentEcid?: string
}

export type IssueReplicaFundsInput = {
  replicaName: string
  amount: string
  idempotencyKey: string
  comment?: string
}

export type StartTelegramWelcomeFunding = (subjectId: string) => Promise<void>

export function getTelegramWelcomeIdempotencyKey(subjectId: string): string {
  return `${TELEGRAM_WELCOME_IDEMPOTENCY_PREFIX}${subjectId}`
}

export async function startTelegramWelcomeFundingWorkflow(
  temporalClient: TemporalClient,
  subjectId: string,
): Promise<void> {
  if (!subjectId.startsWith("telegram:")) {
    return
  }

  await temporalClient.workflow.start("fundTelegramAccountWorkflow", {
    args: [{ subjectId }],
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    workflowId: getTelegramWelcomeFundingWorkflowId(subjectId),
    workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
  })
}

export async function getBalance(
  crypto: ResideCrypto,
  prisma: BankPrisma,
  subjectId: string,
  startTelegramWelcomeFunding?: StartTelegramWelcomeFunding,
): Promise<string> {
  const account = await ensureAccount(crypto, prisma, subjectId, startTelegramWelcomeFunding)

  return await decryptAmount(crypto, account.balanceEcid)
}

export async function listTransactions(
  crypto: ResideCrypto,
  prisma: BankPrisma,
  input: { subjectId: string; pageSize?: number; pageToken?: string },
  startTelegramWelcomeFunding?: StartTelegramWelcomeFunding,
): Promise<{ transactions: BankTransaction[]; nextPageToken?: string }> {
  const result = await listTransactionRecords(crypto, prisma, input, startTelegramWelcomeFunding)
  const transactions = await Promise.all(
    result.transactions.map(async transaction => await mapTransaction(crypto, transaction)),
  )

  return {
    transactions,
    nextPageToken: result.nextPageToken,
  }
}

export async function listTransactionAmountReferences(
  crypto: ResideCrypto,
  prisma: BankPrisma,
  input: { subjectId: string; pageSize?: number; pageToken?: string },
  startTelegramWelcomeFunding?: StartTelegramWelcomeFunding,
): Promise<{ transactions: BankTransactionAmountReference[]; nextPageToken?: string }> {
  const result = await listTransactionRecords(crypto, prisma, input, startTelegramWelcomeFunding)

  return {
    transactions: result.transactions.map(mapTransactionAmountReference),
    nextPageToken: result.nextPageToken,
  }
}

export async function transfer(
  crypto: ResideCrypto,
  prisma: BankPrisma,
  input: TransferInput,
  startTelegramWelcomeFunding?: StartTelegramWelcomeFunding,
): Promise<BankTransaction> {
  const amount = parsePositiveAmount(input.amount)

  if (input.senderSubjectId === input.recipientSubjectId) {
    throw new BankError(strings.errors.differentTransferSubjects)
  }

  return await runLedgerWrite(prisma, async ledgerPrisma => {
    const existing = await ledgerPrisma.transaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    })
    if (existing) {
      return await mapTransaction(crypto, existing)
    }

    const sender = await ensureAccount(
      crypto,
      ledgerPrisma,
      input.senderSubjectId,
      startTelegramWelcomeFunding,
    )
    const recipient = await ensureAccount(
      crypto,
      ledgerPrisma,
      input.recipientSubjectId,
      startTelegramWelcomeFunding,
    )
    const senderBalance = parsePositiveOrZeroAmount(await decryptAmount(crypto, sender.balanceEcid))
    const recipientBalance = parsePositiveOrZeroAmount(
      await decryptAmount(crypto, recipient.balanceEcid),
    )

    if (senderBalance < amount) {
      throw new BankError(strings.errors.insufficientFunds)
    }

    const senderBalanceEcid = await crypto.encrypt((senderBalance - amount).toString())
    const recipientBalanceEcid = await crypto.encrypt((recipientBalance + amount).toString())
    const amountEcid = await crypto.encrypt(amount.toString())
    const commentEcid = input.comment ? await crypto.encrypt(input.comment) : undefined

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
        commentEcid,
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
    const commentEcid = input.comment ? await crypto.encrypt(input.comment) : undefined

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
        commentEcid,
      },
    })

    return await mapTransaction(crypto, transaction)
  })
}

async function ensureAccount(
  crypto: ResideCrypto,
  prisma: BankPrisma,
  subjectId: string,
  startTelegramWelcomeFunding?: StartTelegramWelcomeFunding,
) {
  const existing = await prisma.account.findUnique({ where: { subject_id: subjectId } })
  if (existing) {
    return existing
  }

  const balanceEcid = await crypto.encrypt("0")

  const account = await prisma.account.upsert({
    where: { subject_id: subjectId },
    create: { subject_id: subjectId, balanceEcid },
    update: {},
  })

  await startTelegramWelcomeFunding?.(subjectId)

  return account
}

function getTelegramWelcomeFundingWorkflowId(subjectId: string): string {
  return `fund-telegram-account-${subjectId}`
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

async function listTransactionRecords(
  crypto: ResideCrypto,
  prisma: BankPrisma,
  input: { subjectId: string; pageSize?: number; pageToken?: string },
  startTelegramWelcomeFunding?: StartTelegramWelcomeFunding,
): Promise<{ transactions: TransactionRecord[]; nextPageToken?: string }> {
  await ensureAccount(crypto, prisma, input.subjectId, startTelegramWelcomeFunding)

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

  return {
    transactions: visibleRows,
    nextPageToken: rows.length > pageSize ? visibleRows.at(-1)?.id.toString() : undefined,
  }
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
    comment: transaction.commentEcid
      ? await crypto.decrypt(encryptedCommentSchema, transaction.commentEcid)
      : undefined,
    createdAt: transaction.createdAt.toISOString(),
  }
}

function mapTransactionAmountReference(
  transaction: TransactionRecord,
): BankTransactionAmountReference {
  return {
    id: transaction.id.toString(),
    kind: transaction.kind,
    senderSubjectId: transaction.sender_subject_id ?? undefined,
    recipientSubjectId: transaction.recipient_subject_id,
    amountEcid: transaction.amountEcid,
    commentEcid: transaction.commentEcid ?? undefined,
    createdAt: transaction.createdAt.toISOString(),
  }
}

async function decryptAmount(crypto: ResideCrypto, ecid: string): Promise<string> {
  return await crypto.decrypt(encryptedAmountSchema, ecid)
}

function parsePositiveAmount(value: string): bigint {
  const amount = parsePositiveOrZeroAmount(value)

  if (amount <= 0n) {
    throw new BankError(strings.errors.positiveAmount)
  }

  return amount
}

function parsePositiveOrZeroAmount(value: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new BankError(strings.errors.integerAmount)
  }

  return BigInt(value)
}

function parseBigInt(value: string, fieldName: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new BankError(strings.errors.integerField(fieldName))
  }

  return BigInt(value)
}
