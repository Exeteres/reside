import { defineCommand } from "@reside/common/workflow"
import { strings } from "../locale"

export const helloCommand = defineCommand({
  name: "hello",
  title: strings.commands.hello.title,
  description: strings.commands.hello.description,
})
