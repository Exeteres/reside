import { logger } from "@reside/common"
import { createRateActivities } from "../replica"

const { fetchKeyRate } = createRateActivities()

let exitCode = 0

try {
  logger.info("starting rate e2e")

  // verify CBR API is reachable and returns a valid key rate
  const rate = await fetchKeyRate()

  if (typeof rate !== "number" || Number.isNaN(rate) || rate <= 0) {
    throw new Error(`invalid key rate value: ${rate}`)
  }

  logger.info({ rate }, "rate e2e: key rate fetched successfully")
  logger.info("rate e2e completed")
} catch (error) {
  exitCode = 1

  logger.error(
    { error: error instanceof Error ? error.message : String(error) },
    "rate e2e failed",
  )
} finally {
  process.exit(exitCode)
}
