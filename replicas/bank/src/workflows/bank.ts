import { isResideError } from "@reside/common/definitions"
import { defineCommandHandler, sendNotification } from "@reside/common/workflow"
import { proxyActivities } from "@temporalio/workflow"
import {
  type BankActivities,
  BankNotificationChannels,
  balanceCommand,
  InsufficientFundsError,
  InvalidTransferAmountError,
  InvalidTransferRecipientError,
  transactionsCommand,
  transferCommand,
} from "../definitions"
import { strings } from "../locale"

const activities = proxyActivities<BankActivities>({
  scheduleToCloseTimeout: "30 seconds",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 3,
    nonRetryableErrorTypes: [
      InvalidTransferAmountError.name,
      InvalidTransferRecipientError.name,
      InsufficientFundsError.name,
    ],
  },
})

export const balanceCommandHandler = defineCommandHandler({
  command: balanceCommand,
  async handler({ invocation }) {
    const subjectRhid = resolveSubjectRhid(invocation)
    const balance = await activities.getBalance({ subjectRhid })
    await sendNotification({
      channel: BankNotificationChannels.COMMAND,
      title: strings.notifications.balance(balance.amount),
      system: true,
    })
  },
})
export const transactionsCommandHandler = defineCommandHandler({
  command: transactionsCommand,
  async handler({ invocation }) {
    const subjectRhid = resolveSubjectRhid(invocation)
    const history = await activities.getTransactions({ subjectRhid })
    await sendNotification({
      channel: BankNotificationChannels.COMMAND,
      title:
        history.lines.length === 0
          ? strings.notifications.transactions.empty
          : `${strings.notifications.transactions.title}\n${history.lines.join("\n")}`,
      system: true,
    })
  },
})
export const transferCommandHandler = defineCommandHandler({
  command: transferCommand,
  async handler({ invocation, params }) {
    const subjectRhid = resolveSubjectRhid(invocation)
    const recipientSubjectRhid = invocation.parameters?.recipientSubjectRhid
    if (typeof recipientSubjectRhid !== "string" || recipientSubjectRhid.length === 0) {
      await sendNotification({
        channel: BankNotificationChannels.COMMAND,
        title: strings.notifications.errors.recipientRequired,
        system: true,
      })
      return
    }
    try {
      const result = await activities.transfer({
        senderSubjectRhid: subjectRhid,
        recipientSubjectRhid,
        amount: params.amount,
        comment: params.comment,
      })
      await sendNotification({
        channel: BankNotificationChannels.COMMAND,
        title: strings.notifications.transfer.success(result.amount),
        system: true,
      })
    } catch (error) {
      const title = getTransferFailureTitle(error)
      await sendNotification({ channel: BankNotificationChannels.COMMAND, title, system: true })
    }
  },
})

function getTransferFailureTitle(error: unknown): string {
  if (isResideError(error, InsufficientFundsError.name)) {
    return strings.notifications.errors.insufficientFunds
  }

  if (isResideError(error, InvalidTransferAmountError.name)) {
    return strings.notifications.errors.invalidAmount
  }

  if (isResideError(error, InvalidTransferRecipientError.name)) {
    return strings.notifications.errors.invalidRecipient
  }

  return strings.notifications.transfer.failure
}

function resolveSubjectRhid(invocation: {
  subjectInfo?: Record<string, string>
  subjectId?: string
}): string {
  return invocation.subjectInfo?.telegram_subject_rhid ?? invocation.subjectId ?? ""
}
