import { defineCommand } from "@reside/common/workflow"
import { strings } from "../locale"

export const betCommand = defineCommand({
  name: "bet",
  title: strings.commands.bet.title,
  description: strings.commands.bet.description,
  params: {
    amount: {
      title: strings.commands.bet.params.amount.title,
      description: strings.commands.bet.params.amount.description,
      type: "integer",
      required: true,
    },
    sides: {
      title: strings.commands.bet.params.sides.title,
      description: strings.commands.bet.params.sides.description,
      type: "string",
      required: false,
      rest: true,
    },
  },
})
