import { defineCommandHandler, sendNotification } from "@reside/common/workflow"
import { proxyActivities } from "@temporalio/workflow"
import {
  type BankActivities,
  BankNotificationChannels,
  balanceCommand,
  transactionsCommand,
  transferCommand,
} from "../definitions"
import { strings } from "../locale"

const activities = proxyActivities<BankActivities>({
  scheduleToCloseTimeout: "30 seconds",
  retry: { initialInterval: "3 seconds", backoffCoefficient: 2, maximumAttempts: 3 },
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
      })
      await sendNotification({
        channel: BankNotificationChannels.COMMAND,
        title: strings.notifications.transfer.success(result.amount),
        system: true,
      })
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error)
      const title = code.includes("insufficient_funds")
        ? strings.notifications.errors.insufficientFunds
        : code.includes("invalid_amount")
          ? strings.notifications.errors.invalidAmount
          : strings.notifications.transfer.failure
      await sendNotification({ channel: BankNotificationChannels.COMMAND, title, system: true })
    }
  },
})

function resolveSubjectRhid(invocation: {
  subjectInfo?: Record<string, string>
  subjectId?: string
}): string {
  return invocation.subjectInfo?.telegram_subject_rhid ?? invocation.subjectId ?? ""
}
