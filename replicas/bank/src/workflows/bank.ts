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

const activities = proxyActivities<BankActivities>({
  scheduleToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 1 },
})

export const balanceCommandHandler = defineCommandHandler({
  command: balanceCommand,
  async handler({ invocation }) {
    const { balance } = await activities.getBalance(invocation.subjectId ?? "")
    await sendNotification({
      channel: BankNotificationChannels.BANK,
      title: strings.notifications.balance(balance),
    })
  },
})

export const historyCommandHandler = defineCommandHandler({
  command: historyCommand,
  async handler({ invocation }) {
    const history = await activities.getHistory(invocation.subjectId ?? "")
    await sendNotification({
      channel: BankNotificationChannels.BANK,
      title: history.title,
      message: history.lines.join("\n"),
    })
  },
})

export const transferCommandHandler = defineCommandHandler({
  command: transferCommand,
  async handler({ invocation, params }) {
    try {
      const result = await activities.transfer(
        invocation.subjectId ?? "",
        params.recipient,
        params.amount,
      )
      await sendNotification({ channel: BankNotificationChannels.BANK, title: result.title })
    } catch {
      await sendNotification({
        channel: BankNotificationChannels.BANK,
        title: strings.notifications.transferFailure,
      })
    }
  },
})
