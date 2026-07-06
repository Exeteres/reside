import { defineTool } from "@reside/common"
import { z } from "zod"
import { fetchKeyRate, replaceSingleRateInTitle } from "../business"

type GetRateToolServices = {
  avatarService: {
    getAvatarChatTitle(input: { contextToken: string }): Promise<{ title: string }>
    updateAvatarChatTitle(input: { contextToken: string; title: string }): Promise<unknown>
  }
}

export function createGetRateTool(services: GetRateToolServices) {
  return defineTool("get_rate", {
    description:
      "Gets the current Bank of Russia key rate and updates the current Telegram chat title when an interaction context token is provided.",
    parameters: z.object({
      contextToken: z.string().optional(),
    }),
    handler: async ({ contextToken }) => {
      const rate = await fetchKeyRate({
        fetchFn: fetch,
      })
      let titleUpdated = false

      if (contextToken) {
        const { title } = await services.avatarService.getAvatarChatTitle({ contextToken })
        const updatedTitle = replaceSingleRateInTitle(title, rate)

        if (updatedTitle !== undefined && updatedTitle !== title) {
          await services.avatarService.updateAvatarChatTitle({
            contextToken,
            title: updatedTitle,
          })
          titleUpdated = true
        }
      }

      return {
        rate,
        unit: "percent",
        titleUpdated,
        response: `Current key rate is ${rate}%.`,
      }
    },
  })
}
