import type { PrismaClient } from "../../database"

const USERNAME_PATTERN = /^@?[A-Za-z0-9_]{5,32}$/
const MENTION_PATTERN = /^tg:user:(\d+)$/

export async function getBalance(prisma: PrismaClient, subjectId: string) {
  const account = await findOrCreateAccount(prisma, subjectId)

  return {
    subjectId,
    balance: account.balance,
  }
}

export async function getHistory(prisma: PrismaClient, subjectId: string) {
  const account = await findOrCreateAccount(prisma, subjectId)
  const transfers = await prisma.transfer.findMany({
    where: {
      OR: [{ senderId: account.id }, { recipientId: account.id }],
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      sender: true,
      recipient: true,
    },
  })

  return {
    records: transfers.map(transfer => {
      const outgoing = transfer.senderId === account.id
      return {
        id: transfer.id,
        direction: outgoing ? "outgoing" : "incoming",
        peerSubjectId: outgoing ? transfer.recipient.subjectId : transfer.sender.subjectId,
        amount: transfer.amount,
        createdAt: transfer.createdAt.toISOString(),
      } as const
    }),
  }
}

export async function transferCurrency(
  prisma: PrismaClient,
  input: { senderSubjectId: string; recipientHandle: string; amount: number },
) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("сумма должна быть положительным целым числом")
  }

  const recipientSubjectId = resolveRecipientSubjectId(input.recipientHandle)
  if (recipientSubjectId === input.senderSubjectId) {
    throw new Error("нельзя перевести валюту самому себе")
  }

  return await prisma.$transaction(async tx => {
    const sender = await findOrCreateAccount(tx, input.senderSubjectId)
    const recipient = await findOrCreateAccount(tx, recipientSubjectId)

    if (sender.balance < input.amount) {
      throw new Error("недостаточно средств")
    }

    const updatedSender = await tx.account.update({
      where: { id: sender.id },
      data: { balance: { decrement: input.amount } },
    })
    const updatedRecipient = await tx.account.update({
      where: { id: recipient.id },
      data: { balance: { increment: input.amount } },
    })

    await tx.transfer.create({
      data: {
        senderId: sender.id,
        recipientId: recipient.id,
        amount: input.amount,
        recipientHandle: input.recipientHandle,
      },
    })

    return {
      sender: { subjectId: input.senderSubjectId, balance: updatedSender.balance },
      recipient: { subjectId: recipientSubjectId, balance: updatedRecipient.balance },
    }
  })
}

export function resolveRecipientSubjectId(handle: string): string {
  const value = handle.trim()
  const mention = MENTION_PATTERN.exec(value)
  if (mention?.[1]) {
    return `telegram:${mention[1]}`
  }

  if (USERNAME_PATTERN.test(value)) {
    return `telegram:${value.replace(/^@/, "").toLowerCase()}`
  }

  throw new Error("получатель должен быть юзернеймом или меншеном")
}

async function findOrCreateAccount(
  prisma: Pick<PrismaClient, "account">,
  subjectId: string,
): Promise<{ id: number; subjectId: string; balance: number }> {
  return await prisma.account.upsert({
    where: { subjectId },
    create: { subjectId },
    update: {},
  })
}
