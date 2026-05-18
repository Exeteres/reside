import { logger } from "@reside/common"
import { fetchKeyRate } from "../replica/activities/rate"

const rate = await fetchKeyRate()

if (rate <= 0) {
  throw new Error(`Invalid key rate value "${rate}"`)
}

logger.info('rate e2e succeeded rate="%s"', String(rate))
