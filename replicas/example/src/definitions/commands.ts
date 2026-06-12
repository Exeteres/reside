import { defineCommand } from "@reside/common/workflow"
import { strings } from "../locale"

export const exampleCommand = defineCommand({
  name: "example",
  title: strings.commands.example.title,
  description: strings.commands.example.description,
  params: {
    text: {
      title: strings.commands.example.params.text.title,
      description: strings.commands.example.params.text.description,
      type: "string",
      required: false,
      rest: true,
    },
  },
})
