import { defineCommand } from "@reside/common/workflow"
import { strings } from "../locale"

export const killCommand = defineCommand({
  name: "kill",
  title: strings.commands.kill.title,
  description: strings.commands.kill.description,
  protected: true,
  params: {
    replicaName: {
      title: strings.commands.kill.params.replicaName.title,
      description: strings.commands.kill.params.replicaName.description,
      type: "string",
      required: true,
    },
  },
})
