import { defineCommand } from "@reside/common/workflow"
import { strings } from "../locale"

export const createTaskCommand = defineCommand({
  name: "create_task",
  title: strings.commands.createTask.title,
  description: strings.commands.createTask.description,
  params: {
    task: {
      title: strings.commands.createTask.parameters.task.title,
      description: strings.commands.createTask.parameters.task.description,
      type: "string",
      required: true,
      rest: true,
    },
  },
})
