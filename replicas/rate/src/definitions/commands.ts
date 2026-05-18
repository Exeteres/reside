import { defineCommand } from "@reside/common/workflow"
import { strings } from "../locale"

export const rateCommand = defineCommand({
  name: "rate",
  title: strings.commands.rate.title,
  description: strings.commands.rate.description,
})
