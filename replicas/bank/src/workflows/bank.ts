import { defineCommandHandler, sendNotification } from "@reside/common/workflow"
import { proxyActivities } from "@temporalio/workflow"
import {
  type BankActivities,
  BankNotificationChannels,
  balanceCommand,
  historyCommand,
  transferCommand,
} from "../definitions"
import { strings } from "../locale"

const { getBalance, getHistory, transferCurrency } = proxyActivities<BankActivities>({
  startToCloseTimeout: "30 seconds",
  retry: {
    initialInterval: "1 second",
    maximumAttempts: 1,
  },
})

export const balanceCommandHandler = defineCommandHandler({
  command: balanceCommand,
  async handler({ invocation }) {
    const balance = await getBalance(invocation.subjectId ?? "")
    await sendNotification({
      channel: BankNotificationChannels.BANK,
      title: strings.notifications.balance.title.replace("{amount}", String(balance.balance)),
      expectImmediateFeedback: true,
    })
  },
})

export const historyCommandHandler = defineCommandHandler({
  command: historyCommand,
  async handler({ invocation }) {
    const history = await getHistory(invocation.subjectId ?? "")
    await sendNotification({
      channel: BankNotificationChannels.BANK,
      title: strings.notifications.history.title,
      message:
        history.records.length === 0
          ? strings.notifications.history.empty
          : history.records
              .map(record => {
                const sign = record.direction === "incoming" ? "+" : "-"
                return `${sign}${record.amount}∅: ${record.peerSubjectId}`
              })
              .join("\n"),
      expectImmediateFeedback: true,
    })
  },
})

export const transferCommandHandler = defineCommandHandler({
  command: transferCommand,
  async handler({ invocation, params }) {
    try {
      const result = await transferCurrency({
        senderSubjectId: invocation.subjectId ?? "",
        recipientHandle: params.user,
        amount: params.amount,
      })

      await sendNotification({
        channel: BankNotificationChannels.BANK,
        title: strings.notifications.transfer.success
          .replace("{amount}", String(params.amount))
          .replace("{user}", result.recipient.subjectId),
        expectImmediateFeedback: true,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      await sendNotification({
        channel: BankNotificationChannels.BANK,
        title: strings.notifications.transfer.failure.replace("{reason}", reason),
        expectImmediateFeedback: true,
      })
    }
  },
})
