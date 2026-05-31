import { logger } from "@reside/common"
import { fetchKeyRate } from "../replica/business"

const rate = await fetchKeyRate({
  fetchFn: fetch,
})

if (rate <= 0) {
  throw new Error(`Invalid key rate value "${rate}"`)
}

logger.info('rate e2e succeeded rate="%s"', String(rate))
