import { defineCommand } from "citty"
import { contextArgs, resolveCurrentContextConfig } from "../../shared"

export const clusterInfoCommand = defineCommand({
  args: {
    ...contextArgs,
  },

  async run({ args }) {
    const { account, cluster } = await resolveCurrentContextConfig(args.context)
  },
})
