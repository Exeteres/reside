import { defineCommand } from "@reside/common/workflow"
import { strings } from "../locale"

export const balanceCommand = defineCommand({
  name: "balance",
  title: strings.commands.balance.title,
  description: strings.commands.balance.description,
})

export const historyCommand = defineCommand({
  name: "history",
  title: strings.commands.history.title,
  description: strings.commands.history.description,
})

export const transferCommand = defineCommand({
  name: "transfer",
  title: strings.commands.transfer.title,
  description: strings.commands.transfer.description,
  params: {
    recipient: {
      title: "Получатель",
      description: "Юзернейм или меншен получателя.",
      type: "string",
      required: true,
    },
    amount: {
      title: "Сумма",
      description: "Сумма перевода в ∅.",
      type: "string",
      required: true,
    },
  },
})
