import type { ResideCrypto } from "@reside/common"
import type { PrismaClient } from "../../database"
import type { BankSecurityAuditReport } from "../../definitions"
import { z } from "zod"
import { InsufficientFundsError, InvalidTransferAmountError } from "../../definitions"

const initialBalance = 100n
const encryptedAmountSchema = z.object({ amount: z.string() })
type BankPrisma = Pick<PrismaClient, "account" | "transaction" | "$transaction">

export function getSecurityAuditReport(): BankSecurityAuditReport {
  return {
    summary:
      "Критичные и высокорисковые проблемы не обнаружены. " +
      "Аудит выявил риски, связанные с целостностью переводов и раскрытием финансовых данных пользователю.",
    criticalOrHighRiskFinding: false,
    findings: [
      {
        severity: "medium",
        title: "Баланс обновляется без условной проверки версии счета",
        impact:
          "При конкурентных переводах с одного счета возможна потеря одного из обновлений баланса, " +
          "потому что итоговое значение записывается после чтения текущего остатка.",
        recommendation:
          "Добавить оптимистическую или пессимистическую блокировку счета отправителя при переводе.",
      },
      {
        severity: "medium",
        title: "Получатель перевода задается opaque RHID без подтверждения отображаемого адресата",
        impact:
          "Пользователь может выполнить перевод не тому субъекту, если внешний слой передал неверный RHID получателя.",
        recommendation:
          "Перед выполнением перевода показывать пользователю подтверждение получателя на уровне доверенного интерфейса.",
      },
      {
        severity: "low",
        title:
          "История операций раскрывает точные суммы и время последних переводов владельцу счета",
        impact:
          "Компрометация пользовательского канала взаимодействия даст злоумышленнику детальную финансовую историю счета.",
        recommendation:
          "Считать историю операций чувствительными данными интерфейса и защищать канал доставки уведомлений.",
      },
      {
        severity: "info",
        title: "Суммы и балансы хранятся в зашифрованном виде",
        impact: "Прямое чтение базы данных не раскрывает денежные значения счетов и транзакций.",
        recommendation:
          "Сохранить текущую модель хранения через ECID и не добавлять plaintext-поля для финансовых значений.",
      },
    ],
  }
}

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
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new InvalidTransferAmountError(amount)
  }

  return await prisma.$transaction(async tx => {
    const sender = await ensureAccount(crypto, tx, senderSubjectRhid)
    const recipient = await ensureAccount(crypto, tx, recipientSubjectRhid)
    const senderBalance = BigInt(await decryptAmount(crypto, sender.balanceEcid))
    const transfer = BigInt(amount)
    if (senderBalance < transfer) {
      throw new InsufficientFundsError(senderBalance, transfer)
    }
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
    data: { subjectRhid, balanceEcid: await encryptAmount(crypto, initialBalance) },
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
