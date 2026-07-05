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
  params: {
    page: {
      title: strings.commands.transactions.params.page.title,
      description: strings.commands.transactions.params.page.description,
      type: "integer",
      required: false,
    },
  },
})

export const transferCommand = defineCommand({
  name: "transfer",
  title: strings.commands.transfer.title,
  description: strings.commands.transfer.description,
  params: {
    user: {
      title: strings.commands.transfer.params.user.title,
      description: strings.commands.transfer.params.user.description,
      type: "user",
      required: true,
    },
    amount: {
      title: strings.commands.transfer.params.amount.title,
      description: strings.commands.transfer.params.amount.description,
      type: "string",
      required: true,
    },
  },
})

export const issueReplicaFundsCommand = defineCommand({
  name: "issue_replica_funds",
  title: strings.commands.issueReplicaFunds.title,
  description: strings.commands.issueReplicaFunds.description,
  protected: true,
  params: {
    replicaName: {
      title: strings.commands.issueReplicaFunds.params.replicaName.title,
      description: strings.commands.issueReplicaFunds.params.replicaName.description,
      type: "string",
      required: true,
    },
    amount: {
      title: strings.commands.issueReplicaFunds.params.amount.title,
      description: strings.commands.issueReplicaFunds.params.amount.description,
      type: "string",
      required: true,
    },
  },
})
