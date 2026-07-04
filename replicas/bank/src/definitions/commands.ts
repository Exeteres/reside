import { defineCommand } from "@reside/common/workflow"
import { strings } from "../locale"

export const balanceCommand = defineCommand({
  name: "balance",
  title: strings.commands.balance.title,
  description: strings.commands.balance.description,
})
export const transactionsCommand = defineCommand({
  name: "transactions",
  title: strings.commands.transactions.title,
  description: strings.commands.transactions.description,
})
export const transferCommand = defineCommand({
  name: "transfer",
  title: strings.commands.transfer.title,
  description: strings.commands.transfer.description,
  params: {
    user: {
      title: strings.commands.transfer.params.user.title,
      description: strings.commands.transfer.params.user.description,
      type: "string",
      required: true,
    },
    amount: {
      title: strings.commands.transfer.params.amount.title,
      description: strings.commands.transfer.params.amount.description,
      type: "integer",
      required: true,
    },
  },
})
