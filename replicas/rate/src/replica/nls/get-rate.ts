import { defineTool } from "@github/copilot-sdk"
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
      try {
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
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        return {
          response: `Failed to get key rate: ${errorMessage}`,
        }
      }
    },
  })
}
