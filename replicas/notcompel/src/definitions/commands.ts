import { defineCommand } from "@reside/common/workflow"
import { strings } from "../locale"

export const notcompelCommand = defineCommand({
  name: "notcompel",
  title: strings.commands.notcompel.title,
  description: strings.commands.notcompel.description,
  params: {},
})
