import type { BankTransaction } from "../definitions"
import { isResideError } from "@reside/common/definitions"
import {
  block,
  bold,
  defineCommandHandler,
  type MessageContent,
  sendNotification,
  updateNotification,
} from "@reside/common/workflow"
import { proxyActivities } from "@temporalio/workflow"
import {
  type BankActivities,
  BankError,
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
      nonRetryableErrorTypes: [BankError.name],
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

const TRANSACTIONS_PAGE_SIZE = 5
const PREVIOUS_PAGE_ACTION_NAME = "previous_page"
const NEXT_PAGE_ACTION_NAME = "next_page"

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
    let page = params.page ?? 1
    let notificationId: string | undefined

    while (true) {
      let result: { transactions: BankTransaction[]; nextPageToken?: string }
      try {
        result = await listTransactions({
          subjectId,
          pageSize: TRANSACTIONS_PAGE_SIZE,
          pageToken: page > 1 ? String((page - 1) * TRANSACTIONS_PAGE_SIZE) : undefined,
        })
      } catch (error) {
        await sendBankFailureNotification(error)
        return
      }

      const title = strings.notifications.bank.transactions.title
      const content =
        result.transactions.length === 0
          ? strings.notifications.bank.transactions.empty
          : formatTransactionHistory(result.transactions, subjectId)
      const actions = buildTransactionHistoryActions(page, result.nextPageToken !== undefined)

      const response = notificationId
        ? await updateNotification({
            notificationId,
            title,
            content,
            actions,
            expectImmediateFeedback: true,
          })
        : await sendNotification({
            channel: BankNotificationChannels.COMMAND,
            title,
            message: content,
            actions,
            expectImmediateFeedback: true,
          })

      notificationId = response.notificationId

      if (response.type !== "action") {
        return
      }

      if (response.actionName === PREVIOUS_PAGE_ACTION_NAME && page > 1) {
        page -= 1
        continue
      }

      if (response.actionName === NEXT_PAGE_ACTION_NAME && result.nextPageToken !== undefined) {
        page += 1
        continue
      }

      return
    }
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

function formatTransactionHistory(
  transactions: BankTransaction[],
  subjectId: string,
): MessageContent {
  return block(
    transactions.flatMap((transaction, index) =>
      index === 0
        ? [formatTransactionHistoryEntry(transaction, subjectId)]
        : ["", formatTransactionHistoryEntry(transaction, subjectId)],
    ),
  )
}

function buildTransactionHistoryActions(
  page: number,
  hasNextPage: boolean,
): Record<string, { title: string }> {
  const actions: Record<string, { title: string }> = {}

  if (page > 1) {
    actions[PREVIOUS_PAGE_ACTION_NAME] = {
      title: strings.notifications.bank.transactions.actions.previous,
    }
  }

  if (hasNextPage) {
    actions[NEXT_PAGE_ACTION_NAME] = {
      title: strings.notifications.bank.transactions.actions.next,
    }
  }

  return actions
}

function formatTransactionHistoryEntry(
  transaction: BankTransaction,
  subjectId: string,
): MessageContent {
  const sign = transaction.recipientSubjectId === subjectId ? "+" : "-"
  const date = formatTransactionDate(transaction.createdAt)
  const peer = getTransactionPeerTitle(transaction, subjectId)
  const rows: MessageContent[] = [bold(`${sign}${transaction.amount} ∅ | ${date}`), bold(peer)]

  if (transaction.comment) {
    rows.push(transaction.comment)
  }

  return block(rows)
}

function formatTransactionDate(value: string): string {
  const date = new Date(value)
  const day = padDatePart(date.getUTCDate())
  const month = padDatePart(date.getUTCMonth() + 1)
  const year = date.getUTCFullYear()
  const hours = padDatePart(date.getUTCHours())
  const minutes = padDatePart(date.getUTCMinutes())

  return `${day}.${month}.${year} ${hours}:${minutes}`
}

function padDatePart(value: number): string {
  return value.toString().padStart(2, "0")
}

function getTransactionPeerTitle(transaction: BankTransaction, subjectId: string): string {
  const peerSubjectId =
    transaction.recipientSubjectId === subjectId
      ? transaction.senderSubjectId
      : transaction.recipientSubjectId

  return peerSubjectId ?? "-"
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
    message: formatErrorMessage(error),
  })
}

function formatErrorMessage(error: unknown): string {
  if (isResideError(error, BankError.name)) {
    return getBankErrorMessage(error) ?? strings.notifications.bank.failure.title
  }

  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function getBankErrorMessage(error: unknown): string | undefined {
  if (error instanceof BankError && error.message.length > 0) {
    return error.message
  }

  if (error === null || typeof error !== "object") {
    return undefined
  }

  const isSerializedBankError =
    ("type" in error && error.type === BankError.name) ||
    ("name" in error && error.name === BankError.name)

  if (
    isSerializedBankError &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.length > 0
  ) {
    return error.message
  }

  if ("cause" in error) {
    return getBankErrorMessage(error.cause)
  }

  return undefined
}
