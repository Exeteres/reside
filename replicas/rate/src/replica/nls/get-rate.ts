import { defineTool } from "@github/copilot-sdk"
import { z } from "zod"
import { fetchKeyRate } from "../business"

export const getRateTool = defineTool("get_rate", {
  description: "Gets the current Bank of Russia key rate.",
  parameters: z.object({}),
  handler: async () => {
    try {
      const rate = await fetchKeyRate({
        fetchFn: fetch,
      })

      return {
        rate,
        unit: "percent",
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
