import { defineCommand } from "@reside/common/workflow"
import { strings } from "../locale"

export const imageCommand = defineCommand({
  name: "image",
  title: strings.commands.image.title,
  description: strings.commands.image.description,
  params: {
    size: {
      title: strings.commands.image.params.size.title,
      description: strings.commands.image.params.size.description,
      type: "string",
      required: true,
    },
    prompt: {
      title: strings.commands.image.params.prompt.title,
      description: strings.commands.image.params.prompt.description,
      type: "string",
      required: true,
      rest: true,
    },
  },
})
