import type { RateActivities } from "../../definitions"
import { fetchKeyRate } from "../business"

export function createRateActivities(): RateActivities {
  return {
    async fetchKeyRate() {
      return {
        rate: await fetchKeyRate({
          fetchFn: fetch,
        }),
      }
    },
  }
}
