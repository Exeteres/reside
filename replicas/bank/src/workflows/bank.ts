import type { BankTransaction } from "../definitions"
import { defineCommandHandler, sendNotification } from "@reside/common/workflow"
import { proxyActivities } from "@temporalio/workflow"
import {
  type BankActivities,
  BankNotificationChannels,
  balanceCommand,
  issueReplicaFundsCommand,
  transactionsCommand,
  transferCommand,
} from "../definitions"
import { strings } from "../locale"

const { getBalance, issueReplicaFunds, listTransactions, transfer } =
  proxyActivities<BankActivities>({
    scheduleToCloseTimeout: "30 seconds",
    retry: {
      initialInterval: "3 seconds",
      backoffCoefficient: 2,
      maximumAttempts: 3,
    },
  })

const { fundTelegramAccount } = proxyActivities<BankActivities>({
  scheduleToCloseTimeout: "365 days",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
  },
})

export async function fundTelegramAccountWorkflow({
  subjectId,
}: {
  subjectId: string
}): Promise<void> {
  await fundTelegramAccount({ subjectId })
}

export const balanceCommandHandler = defineCommandHandler({
  command: balanceCommand,
  async handler({ context }) {
    if (!context.subjectId) {
      throw new Error("Command invocation is missing subjectId")
    }

    let result: { balance: string }
    try {
      result = await getBalance({ subjectId: context.subjectId })
    } catch (error) {
      await sendBankFailureNotification(error)
      return
    }

    await sendNotification({
      channel: BankNotificationChannels.COMMAND,
      title: strings.notifications.bank.balance(result.balance),
    })
  },
})

export const transactionsCommandHandler = defineCommandHandler({
  command: transactionsCommand,
  async handler({ context, params }) {
    if (!context.subjectId) {
      throw new Error("Command invocation is missing subjectId")
    }
    const subjectId = context.subjectId
    const page = params.page ?? 1
    let result: { transactions: BankTransaction[]; nextPageToken?: string }
    try {
      result = await listTransactions({
        subjectId,
        pageSize: 10,
        pageToken: page > 1 ? String((page - 1) * 10) : undefined,
      })
    } catch (error) {
      await sendBankFailureNotification(error)
      return
    }

    const lines = result.transactions
      .map(transaction => formatTransactionHistoryLine(transaction, subjectId))
      .join("\n")

    await sendNotification({
      channel: BankNotificationChannels.COMMAND,
      title: strings.notifications.bank.transactions.title,
      message: lines || strings.notifications.bank.transactions.empty,
    })
  },
})

export const transferCommandHandler = defineCommandHandler({
  command: transferCommand,
  async handler({ context, params }) {
    if (!context.subjectId) {
      throw new Error("Command invocation is missing subjectId")
    }
    if (!context.invocationId) {
      throw new Error("Command invocation is missing invocationId")
    }
    if (!params.user || !params.amount) {
      throw new Error("Transfer command is missing required parameters")
    }

    let result: { transaction: BankTransaction }
    try {
      result = await transfer({
        senderSubjectId: context.subjectId,
        recipientSubjectId: params.user,
        amount: params.amount,
        idempotencyKey: context.invocationId,
      })
    } catch (error) {
      await sendBankFailureNotification(error)
      return
    }

    await sendNotification({
      channel: BankNotificationChannels.COMMAND,
      title: strings.notifications.bank.transfer(result.transaction.amount),
    })
  },
})

function formatTransactionHistoryLine(transaction: BankTransaction, subjectId: string): string {
  const from = transaction.senderSubjectId ?? "-"
  const to = transaction.recipientSubjectId
  const sign = transaction.recipientSubjectId === subjectId ? "+" : "-"

  return `[${transaction.id}] ${from} -> ${to}: ${sign} ${transaction.amount} ∅`
}

export const issueReplicaFundsCommandHandler = defineCommandHandler({
  command: issueReplicaFundsCommand,
  async handler({ context, params }) {
    if (!context.subjectId) {
      throw new Error("Command invocation is missing subjectId")
    }
    if (!context.invocationId) {
      throw new Error("Command invocation is missing invocationId")
    }
    if (!params.replicaName || !params.amount) {
      throw new Error("Issue command is missing required parameters")
    }

    let result: { transaction: BankTransaction }
    try {
      result = await issueReplicaFunds({
        callerSubjectId: context.subjectId,
        replicaName: params.replicaName,
        amount: params.amount,
        idempotencyKey: context.invocationId,
      })
    } catch (error) {
      await sendBankFailureNotification(error)
      return
    }

    const recipientSubjectId = `replica:${params.replicaName}`

    await sendNotification({
      channel: BankNotificationChannels.COMMAND,
      title: strings.notifications.bank.issue(result.transaction.amount, recipientSubjectId),
    })
  },
})

async function sendBankFailureNotification(error: unknown): Promise<void> {
  await sendNotification({
    channel: BankNotificationChannels.COMMAND,
    title: strings.notifications.bank.failure.title,
    message: strings.notifications.bank.failure.message(formatErrorMessage(error)),
  })
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
