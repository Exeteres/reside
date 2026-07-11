import type {
  BankTransaction,
  ConfirmPaymentRequestWorkflowInput,
  PaymentRequestResult,
} from "../definitions"
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

const {
  approvePaymentRequest,
  failPaymentRequest,
  getBalance,
  getPendingPaymentRequest,
  issueReplicaFunds,
  listTransactions,
  rejectPaymentRequest,
  transfer,
} = proxyActivities<BankActivities>({
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
const ACCEPT_PAYMENT_ACTION_NAME = "accept"
const ACCEPT_PAYMENT_ALWAYS_ACTION_NAME = "accept_always"
const REJECT_PAYMENT_ACTION_NAME = "reject"
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000

export async function fundTelegramAccountWorkflow({
  subjectId,
}: {
  subjectId: string
}): Promise<void> {
  await fundTelegramAccount({ subjectId })
}

export async function confirmPaymentRequestWorkflow({
  operationId,
}: ConfirmPaymentRequestWorkflowInput): Promise<void> {
  const paymentRequest = await getPendingPaymentRequest({ operationId })
  const response = await sendNotification({
    system: true,
    channel: BankNotificationChannels.PAYMENT_REQUESTS,
    partition: paymentRequest.payerSubjectId,
    title: strings.notifications.bank.paymentRequest.title,
    message: formatPaymentRequestMessage(paymentRequest),
    actions: {
      [ACCEPT_PAYMENT_ACTION_NAME]: {
        title: strings.notifications.bank.paymentRequest.actions.accept,
      },
      [ACCEPT_PAYMENT_ALWAYS_ACTION_NAME]: {
        title: strings.notifications.bank.paymentRequest.actions.acceptAlways,
      },
      [REJECT_PAYMENT_ACTION_NAME]: {
        title: strings.notifications.bank.paymentRequest.actions.reject,
      },
    },
    expectImmediateFeedback: true,
  })

  if (response.type !== "action") {
    return
  }

  if (response.actionName === REJECT_PAYMENT_ACTION_NAME) {
    await rejectPaymentRequest({ operationId })
    await updateNotification({
      notificationId: response.notificationId,
      title: strings.notifications.bank.paymentRequest.title,
      content: strings.notifications.bank.paymentRequest.rejected,
      actions: {},
      requiresTextResponse: false,
    })
    return
  }

  const approveAlways = response.actionName === ACCEPT_PAYMENT_ALWAYS_ACTION_NAME
  let result: { result: PaymentRequestResult }
  try {
    result = await approvePaymentRequest({ operationId, approveAlways })
  } catch (error) {
    const failureMessage = error instanceof Error ? error.message : strings.errors.insufficientFunds
    await failPaymentRequest({ operationId, failureMessage })
    await updateNotification({
      notificationId: response.notificationId,
      title: strings.notifications.bank.failure.title,
      content: failureMessage,
      actions: {},
      requiresTextResponse: false,
    })
    return
  }

  if (!result.result.transaction) {
    throw new Error("Approved payment request is missing transaction")
  }

  await updateNotification({
    notificationId: response.notificationId,
    title: strings.notifications.bank.paymentRequest.title,
    content: approveAlways
      ? strings.notifications.bank.paymentRequest.approvedAlways(result.result.transaction.amount)
      : strings.notifications.bank.paymentRequest.approved(result.result.transaction.amount),
    actions: {},
    requiresTextResponse: false,
  })
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
    const initialPage = Math.max(params.page ?? 1, 1)
    const previousPageTokens: (string | undefined)[] = []
    let page = 1
    let pageToken: string | undefined
    let notificationId: string | undefined

    while (page < initialPage) {
      const result = await listTransactions({
        subjectId,
        pageSize: TRANSACTIONS_PAGE_SIZE,
        pageToken,
      })

      if (result.nextPageToken === undefined) {
        break
      }

      previousPageTokens.push(pageToken)
      pageToken = result.nextPageToken
      page += 1
    }

    while (true) {
      let result: { transactions: BankTransaction[]; nextPageToken?: string }
      try {
        result = await listTransactions({
          subjectId,
          pageSize: TRANSACTIONS_PAGE_SIZE,
          pageToken,
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
        pageToken = previousPageTokens.pop()
        page -= 1
        continue
      }

      if (response.actionName === NEXT_PAGE_ACTION_NAME && result.nextPageToken !== undefined) {
        previousPageTokens.push(pageToken)
        pageToken = result.nextPageToken
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

function formatPaymentRequestMessage(paymentRequest: {
  requesterSubjectId: string
  amount: string
  commentEcid?: string
}): MessageContent {
  const rows: MessageContent[] = [
    strings.notifications.bank.paymentRequest.message(
      paymentRequest.amount,
      paymentRequest.requesterSubjectId,
    ),
  ]

  if (paymentRequest.commentEcid) {
    rows.push("", strings.notifications.bank.paymentRequest.comment(paymentRequest.commentEcid))
  }

  return block(rows)
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
  const date = new Date(new Date(value).getTime() + MSK_OFFSET_MS)
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
